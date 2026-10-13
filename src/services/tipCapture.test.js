'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  tipInput, orderPayeeMerchantId, checkPendingTip, decideTipCapture, handleTipReturn, paypalIssue,
  DONOR_NAME_MAX, MESSAGE_MAX,
} = require('./tipCapture');

// ── Fixtures (synthetic values only) ────────────────────────────────

const STREAMER = { id: 7, twitch_username: 'teststreamer', paypal_email: 'Streamer@Example.com' };

function pendingRow(over) {
  return {
    order_id: 'ORDER-1234567890', streamer_id: 7, donor_name: 'Viewer', message: 'Keep racing!',
    payee_merchant_id: null, captured_at: null, created_at: '2026-10-13 12:00:00', ...over,
  };
}

// Shape of a PayPal Orders v2 capture response with `Prefer: return=representation`:
// the order with purchase_units[0].payee and purchase_units[0].payments.captures[0].
function captureResponse(over = {}) {
  const payment = {
    id: 'CAPTURE-1', status: 'COMPLETED',
    amount: { currency_code: 'EUR', value: '10.00' },
    ...(over.payment || {}),
  };
  return {
    id: 'ORDER-1234567890',
    status: over.status || 'COMPLETED',
    purchase_units: [{
      reference_id: 'default',
      payee: over.payee !== undefined ? over.payee : { email_address: 'streamer@example.com' },
      payments: { captures: [payment] },
    }],
  };
}

describe('decideTipCapture', () => {
  test('valid capture: amount and currency come from PayPal, name and message from the pending row', () => {
    const verdict = decideTipCapture({ streamer: STREAMER, pending: pendingRow(), capture: captureResponse() });
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.donation, {
      orderId: 'ORDER-1234567890', donorName: 'Viewer', message: 'Keep racing!', amount: 10, currency: 'EUR',
    });
  });

  test('payee mismatch: the money went to a different PayPal account', () => {
    const capture = captureResponse({ payee: { email_address: 'someone-else@example.com' } });
    const verdict = decideTipCapture({ streamer: STREAMER, pending: pendingRow(), capture });
    assert.deepEqual(verdict, { ok: false, reason: 'payee_mismatch' });
  });

  test('payee missing from the response cannot be verified', () => {
    for (const payee of [null, {}]) {
      const verdict = decideTipCapture({ streamer: STREAMER, pending: pendingRow(), capture: captureResponse({ payee }) });
      assert.deepEqual(verdict, { ok: false, reason: 'payee_mismatch' });
    }
  });

  test('streamer mismatch: an order created on another streamer\'s tip page', () => {
    const verdict = decideTipCapture({ streamer: STREAMER, pending: pendingRow({ streamer_id: 8 }), capture: captureResponse() });
    assert.deepEqual(verdict, { ok: false, reason: 'streamer_mismatch' });
  });

  test('missing pending row: an order this server did not create (or older than 24 h)', () => {
    const verdict = decideTipCapture({ streamer: STREAMER, pending: null, capture: captureResponse() });
    assert.deepEqual(verdict, { ok: false, reason: 'no_pending' });
  });

  test('replay: a capture that was already handled is never counted again', () => {
    const verdict = decideTipCapture({
      streamer: STREAMER, pending: pendingRow({ captured_at: '2026-10-13 12:01:00' }), capture: captureResponse(),
    });
    assert.deepEqual(verdict, { ok: false, reason: 'replay' });
  });

  test('a completed order whose capture was declined or failed is not a donation', () => {
    for (const status of ['DECLINED', 'FAILED']) {
      const verdict = decideTipCapture({
        streamer: STREAMER, pending: pendingRow(), capture: captureResponse({ payment: { status } }),
      });
      assert.deepEqual(verdict, { ok: false, reason: 'not_completed' });
    }
  });

  test('a pending capture (PayPal still settling it) counts like before', () => {
    const verdict = decideTipCapture({
      streamer: STREAMER, pending: pendingRow(), capture: captureResponse({ payment: { status: 'PENDING' } }),
    });
    assert.equal(verdict.ok, true);
  });

  test('PayPal errors and orders that are not completed are refused', () => {
    const error = { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }], debug_id: 'abc123' };
    for (const capture of [error, captureResponse({ status: 'APPROVED' }), null, {}, { status: 'COMPLETED' }]) {
      const verdict = decideTipCapture({ streamer: STREAMER, pending: pendingRow(), capture });
      assert.deepEqual(verdict, { ok: false, reason: 'not_completed' });
    }
  });

  test('a capture without a usable amount is refused', () => {
    for (const amount of [{ value: '0.00', currency_code: 'EUR' }, { value: 'abc', currency_code: 'EUR' },
      { value: '5.00' }, { value: '5.00', currency_code: 'euro' }, undefined]) {
      const verdict = decideTipCapture({
        streamer: STREAMER, pending: pendingRow(), capture: captureResponse({ payment: { amount } }),
      });
      assert.deepEqual(verdict, { ok: false, reason: 'bad_amount' });
    }
  });

  test('payee email is compared without case or surrounding spaces', () => {
    const capture = captureResponse({ payee: { email_address: ' STREAMER@example.COM ' } });
    assert.equal(decideTipCapture({ streamer: STREAMER, pending: pendingRow(), capture }).ok, true);
    const noEmail = { ...STREAMER, paypal_email: null };
    assert.equal(decideTipCapture({ streamer: noEmail, pending: pendingRow(), capture }).reason, 'payee_mismatch');
  });

  test('merchant_id only: matches the account PayPal named when the order was created', () => {
    const capture = captureResponse({ payee: { merchant_id: 'MERCHANT12345' } });
    const recorded = pendingRow({ payee_merchant_id: 'MERCHANT12345' });
    assert.equal(decideTipCapture({ streamer: STREAMER, pending: recorded, capture }).ok, true);
    const other = pendingRow({ payee_merchant_id: 'OTHERMERCHANT' });
    assert.equal(decideTipCapture({ streamer: STREAMER, pending: other, capture }).reason, 'payee_mismatch');
    // Nothing recorded at order creation: the account cannot be tied to this streamer.
    assert.equal(decideTipCapture({ streamer: STREAMER, pending: pendingRow(), capture }).reason, 'payee_mismatch');
  });

  test('email and merchant_id together must both match', () => {
    const capture = captureResponse({ payee: { email_address: 'streamer@example.com', merchant_id: 'MERCHANT12345' } });
    assert.equal(decideTipCapture({ streamer: STREAMER, pending: pendingRow({ payee_merchant_id: 'MERCHANT12345' }), capture }).ok, true);
    assert.equal(decideTipCapture({ streamer: STREAMER, pending: pendingRow({ payee_merchant_id: 'OTHERMERCHANT' }), capture }).reason, 'payee_mismatch');
    // The email alone is enough when no merchant id was recorded.
    assert.equal(decideTipCapture({ streamer: STREAMER, pending: pendingRow(), capture }).ok, true);
  });

  test('streamer ids are compared as numbers', () => {
    const verdict = decideTipCapture({ streamer: { ...STREAMER, id: '7' }, pending: pendingRow(), capture: captureResponse() });
    assert.equal(verdict.ok, true);
  });
});

describe('checkPendingTip', () => {
  test('accepts a fresh pending row of this streamer', () => {
    assert.equal(checkPendingTip(STREAMER, pendingRow()), null);
    assert.equal(checkPendingTip(STREAMER, null), 'no_pending');
    assert.equal(checkPendingTip(STREAMER, pendingRow({ streamer_id: 99 })), 'streamer_mismatch');
    assert.equal(checkPendingTip(STREAMER, pendingRow({ captured_at: 'now' })), 'replay');
  });
});

// ── handleTipReturn: the whole return from PayPal with stubbed effects ──

function harness({ pending = pendingRow(), capture = captureResponse(), captureThrows = null } = {}) {
  const rows = new Map(pending ? [[pending.order_id, { ...pending }]] : []);
  const logged = new Set();
  const calls = { capture: 0, announce: [], logDonation: 0 };
  const deps = {
    getPendingTip: (id) => (rows.has(id) ? { ...rows.get(id) } : null),
    capture: async () => {
      calls.capture++;
      if (captureThrows) throw captureThrows;
      return capture;
    },
    markCaptured: (id) => { if (rows.has(id)) rows.get(id).captured_at = '2026-10-13 12:01:00'; },
    // Same rule as db.logDonation: one row per (source, external_id)
    logDonation: (d) => {
      calls.logDonation++;
      if (logged.has(d.orderId)) return false;
      logged.add(d.orderId);
      return true;
    },
    announce: (d) => calls.announce.push(d),
  };
  return { deps, calls, rows, logged };
}

describe('handleTipReturn', () => {
  test('valid return: logs once and announces once', async () => {
    const h = harness();
    const result = await handleTipReturn({ streamer: STREAMER, orderId: 'ORDER-1234567890' }, h.deps);
    assert.equal(result.ok, true);
    assert.equal(result.isNew, true);
    assert.equal(h.calls.capture, 1);
    assert.equal(h.calls.announce.length, 1);
    assert.equal(h.calls.announce[0].amount, 10);
    assert.ok(h.rows.get('ORDER-1234567890').captured_at, 'pending row is marked captured');
  });

  test('replay: reloading the return URL succeeds without calling PayPal or announcing again', async () => {
    const h = harness();
    await handleTipReturn({ streamer: STREAMER, orderId: 'ORDER-1234567890' }, h.deps);
    const again = await handleTipReturn({ streamer: STREAMER, orderId: 'ORDER-1234567890' }, h.deps);
    assert.deepEqual(again, { ok: true, replay: true });
    assert.equal(h.calls.capture, 1);
    assert.equal(h.calls.announce.length, 1);
  });

  test('replay: a capture already in the donation history is not announced again', async () => {
    const h = harness();
    h.logged.add('ORDER-1234567890');
    const result = await handleTipReturn({ streamer: STREAMER, orderId: 'ORDER-1234567890' }, h.deps);
    assert.equal(result.ok, true);
    assert.equal(result.isNew, false);
    assert.equal(h.calls.announce.length, 0);
  });

  test('missing pending row: refused before PayPal is called', async () => {
    const h = harness({ pending: null });
    const result = await handleTipReturn({ streamer: STREAMER, orderId: 'ORDER-1234567890' }, h.deps);
    assert.deepEqual(result, { ok: false, reason: 'no_pending' });
    assert.equal(h.calls.capture, 0);
    assert.equal(h.calls.logDonation, 0);
    assert.equal(h.calls.announce.length, 0);
  });

  test('streamer mismatch: refused before PayPal is called', async () => {
    const h = harness({ pending: pendingRow({ streamer_id: 8 }) });
    const result = await handleTipReturn({ streamer: STREAMER, orderId: 'ORDER-1234567890' }, h.deps);
    assert.deepEqual(result, { ok: false, reason: 'streamer_mismatch' });
    assert.equal(h.calls.capture, 0);
    assert.equal(h.calls.announce.length, 0);
    assert.equal(h.rows.get('ORDER-1234567890').captured_at, null);
  });

  test('payee mismatch: no alert, no chat, no goal and no history row', async () => {
    const h = harness({ capture: captureResponse({ payee: { email_address: 'someone-else@example.com' } }) });
    const result = await handleTipReturn({ streamer: STREAMER, orderId: 'ORDER-1234567890' }, h.deps);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'payee_mismatch');
    assert.equal(h.calls.logDonation, 0);
    assert.equal(h.calls.announce.length, 0);
    assert.equal(h.rows.get('ORDER-1234567890').captured_at, null);
  });

  test('PayPal unreachable: reported as a failed capture with nothing recorded', async () => {
    const h = harness({ captureThrows: new Error('The operation was aborted due to timeout') });
    const result = await handleTipReturn({ streamer: STREAMER, orderId: 'ORDER-1234567890' }, h.deps);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'capture_failed');
    assert.equal(h.calls.logDonation, 0);
    assert.equal(h.calls.announce.length, 0);
  });

  test('a declined capture is reported with PayPal\'s status for the log', async () => {
    const h = harness({ capture: captureResponse({ payment: { status: 'DECLINED' } }) });
    const result = await handleTipReturn({ streamer: STREAMER, orderId: 'ORDER-1234567890' }, h.deps);
    assert.equal(result.reason, 'not_completed');
    assert.match(result.detail, /DECLINED/);
    assert.equal(h.calls.announce.length, 0);
  });
});

describe('paypalIssue', () => {
  test('summarises a PayPal answer without payer details', () => {
    assert.equal(paypalIssue({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }], debug_id: 'abc123' }),
      'UNPROCESSABLE_ENTITY INSTRUMENT_DECLINED debug_id=abc123');
    assert.equal(paypalIssue(captureResponse({ payment: { status: 'DECLINED' } })), 'order=COMPLETED capture=DECLINED');
    assert.equal(paypalIssue(null), '');
  });
});

describe('tipInput', () => {
  test('caps the donor name and message, and defaults the name', () => {
    const long = tipInput({ donor_name: 'n'.repeat(80), message: 'm'.repeat(500) });
    assert.equal(long.donorName.length, DONOR_NAME_MAX);
    assert.equal(long.message.length, MESSAGE_MAX);
    assert.equal(DONOR_NAME_MAX, 50);
    assert.equal(MESSAGE_MAX, 200);
    assert.deepEqual(tipInput({}), { donorName: 'Anonymous', message: '' });
    assert.deepEqual(tipInput(undefined), { donorName: 'Anonymous', message: '' });
    assert.deepEqual(tipInput({ donor_name: '   ', message: '  hi  ' }), { donorName: 'Anonymous', message: 'hi' });
  });

  test('keeps everything on one line and ignores non-text values', () => {
    assert.deepEqual(tipInput({ donor_name: 'A\r\nB\u0000C', message: 'one\ntwo\u2028three' }),
      { donorName: 'A  B C', message: 'one two three' });
    assert.deepEqual(tipInput({ donor_name: ['x', 'y'], message: { a: 1 } }), { donorName: 'Anonymous', message: '' });
  });
});

describe('orderPayeeMerchantId', () => {
  test('reads the merchant id PayPal returns for the payee on order creation', () => {
    assert.equal(orderPayeeMerchantId({ purchase_units: [{ payee: { email_address: 'a@b.co', merchant_id: 'MERCHANT12345' } }] }), 'MERCHANT12345');
    assert.equal(orderPayeeMerchantId({ purchase_units: [{ payee: { email_address: 'a@b.co' } }] }), null);
    assert.equal(orderPayeeMerchantId({ id: 'X', status: 'CREATED', links: [] }), null);
    assert.equal(orderPayeeMerchantId(null), null);
  });
});
