'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  tipInput, orderPayeeMerchantId, checkPendingTip, decideTipCapture, handleTipReturn, paypalIssue, tipErrorResponse,
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
    // (An "already captured" answer never gets here: handleTipReturn reads the order instead.)
    const error = { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }], debug_id: 'abc123' };
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

  test('a recorded merchant id decides whenever PayPal names one', () => {
    const decide = (payee, recorded) => decideTipCapture({
      streamer: STREAMER, pending: pendingRow({ payee_merchant_id: recorded }), capture: captureResponse({ payee }),
    });
    const same = 'streamer@example.com';
    const other = 'primary@example.com';
    // PayPal may show the account's other email; the recorded account id still proves the payee.
    assert.equal(decide({ email_address: other, merchant_id: 'MERCHANT12345' }, 'MERCHANT12345').ok, true);
    assert.equal(decide({ email_address: same, merchant_id: 'MERCHANT12345' }, 'MERCHANT12345').ok, true);
    assert.equal(decide({ email_address: same, merchant_id: 'MERCHANT12345' }, 'OTHERMERCHANT').reason, 'payee_mismatch');
    // Nothing recorded at order creation: the email decides.
    assert.equal(decide({ email_address: same, merchant_id: 'MERCHANT12345' }, null).ok, true);
    assert.equal(decide({ email_address: other, merchant_id: 'MERCHANT12345' }, null).reason, 'payee_mismatch');
    // Recorded, but PayPal names the payee only by email: the email decides.
    assert.equal(decide({ email_address: same }, 'MERCHANT12345').ok, true);
    assert.equal(decide({ email_address: other }, 'MERCHANT12345').reason, 'payee_mismatch');
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

const ORDER = 'ORDER-1234567890';
// PayPal's answer to a capture of an order that is already captured.
const ALREADY_CAPTURED = {
  name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }], debug_id: 'abc123',
};

// `order` is what reading the order (GET) returns; tests swap deps for sequences.
function harness({ pending = pendingRow(), capture = captureResponse(), captureThrows = null,
  order = captureResponse(), orderThrows = null } = {}) {
  const rows = new Map(pending ? [[pending.order_id, { ...pending }]] : []);
  const logged = new Set();
  const calls = { capture: 0, getOrder: 0, announce: [], logDonation: 0 };
  const deps = {
    getPendingTip: (id) => (rows.has(id) ? { ...rows.get(id) } : null),
    capture: async () => {
      calls.capture++;
      if (captureThrows) throw captureThrows;
      return capture;
    },
    getOrder: async () => {
      calls.getOrder++;
      if (orderThrows) throw orderThrows;
      return order;
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
    const h = harness({
      captureThrows: new Error('The operation was aborted due to timeout'), orderThrows: new Error('fetch failed'),
    });
    const result = await handleTipReturn({ streamer: STREAMER, orderId: 'ORDER-1234567890' }, h.deps);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'capture_failed');
    assert.equal(h.calls.getOrder, 1, 'the order was read before giving up');
    assert.equal(h.calls.logDonation, 0);
    assert.equal(h.calls.announce.length, 0);
    assert.equal(h.rows.get(ORDER).captured_at, null);
  });

  test('a declined capture is reported with PayPal\'s status for the log', async () => {
    const h = harness({ capture: captureResponse({ payment: { status: 'DECLINED' } }) });
    const result = await handleTipReturn({ streamer: STREAMER, orderId: 'ORDER-1234567890' }, h.deps);
    assert.equal(result.reason, 'not_completed');
    assert.match(result.detail, /DECLINED/);
    assert.equal(h.calls.getOrder, 0, 'a definite refusal is not looked up again');
    assert.equal(h.calls.announce.length, 0);
  });

  test('reload while the first capture is still running: both pages thank the viewer, announced once', async () => {
    const h = harness();
    let release;
    let n = 0;
    h.deps.capture = () => {
      h.calls.capture++;
      n++;
      return n === 1 ? new Promise((resolve) => { release = () => resolve(captureResponse()); }) : Promise.resolve(ALREADY_CAPTURED);
    };
    const first = handleTipReturn({ streamer: STREAMER, orderId: ORDER }, h.deps);
    const reload = await handleTipReturn({ streamer: STREAMER, orderId: ORDER }, h.deps); // the page the browser shows
    release();
    const firstResult = await first;
    assert.equal(reload.ok, true);
    assert.equal(firstResult.ok, true);
    assert.equal(h.calls.getOrder, 1, 'the reload read the order PayPal had already captured');
    assert.equal(h.calls.announce.length, 1);
    assert.equal(h.logged.size, 1);
  });

  test('capture answer lost (timeout): the order is read and the tip counts once', async () => {
    const h = harness({ captureThrows: new Error('The operation was aborted due to timeout') });
    const first = await handleTipReturn({ streamer: STREAMER, orderId: ORDER }, h.deps);
    assert.equal(first.ok, true);
    assert.equal(first.isNew, true);
    assert.equal(h.calls.getOrder, 1);
    assert.equal(h.calls.announce.length, 1);
    const reload = await handleTipReturn({ streamer: STREAMER, orderId: ORDER }, h.deps);
    assert.deepEqual(reload, { ok: true, replay: true });
    assert.equal(h.calls.announce.length, 1);
  });

  test('capture answer lost and the order cannot be read yet: a reload recovers it', async () => {
    const h = harness({ orderThrows: new Error('fetch failed') });
    let n = 0;
    h.deps.capture = async () => {
      h.calls.capture++;
      n++;
      if (n === 1) throw new Error('The operation was aborted due to timeout');
      return ALREADY_CAPTURED;
    };
    const first = await handleTipReturn({ streamer: STREAMER, orderId: ORDER }, h.deps);
    assert.equal(first.reason, 'capture_failed');
    assert.equal(h.calls.announce.length, 0);
    h.deps.getOrder = async () => { h.calls.getOrder++; return captureResponse(); }; // PayPal reachable again
    const reload = await handleTipReturn({ streamer: STREAMER, orderId: ORDER }, h.deps);
    assert.equal(reload.ok, true);
    assert.equal(reload.isNew, true);
    assert.equal(h.calls.announce.length, 1);
  });

  test('a capture that never reached PayPal records nothing, and a reload captures normally', async () => {
    const approved = { id: ORDER, status: 'APPROVED', purchase_units: [{ payee: { email_address: 'streamer@example.com' } }] };
    const h = harness({ order: approved });
    let n = 0;
    h.deps.capture = async () => {
      h.calls.capture++;
      n++;
      if (n === 1) throw new Error('fetch failed');
      return captureResponse();
    };
    const first = await handleTipReturn({ streamer: STREAMER, orderId: ORDER }, h.deps);
    assert.equal(first.reason, 'capture_failed');
    assert.equal(h.calls.logDonation, 0);
    assert.equal(h.rows.get(ORDER).captured_at, null);
    const reload = await handleTipReturn({ streamer: STREAMER, orderId: ORDER }, h.deps);
    assert.equal(reload.ok, true);
    assert.equal(reload.isNew, true);
    assert.equal(h.calls.announce.length, 1);
  });

  test('PayPal says already captured and the tip is already recorded: thank-you page, no new alert', async () => {
    const h = harness({ capture: ALREADY_CAPTURED });
    h.logged.add(ORDER);
    const result = await handleTipReturn({ streamer: STREAMER, orderId: ORDER }, h.deps);
    assert.equal(result.ok, true);
    assert.equal(result.isNew, false);
    assert.equal(h.calls.getOrder, 1);
    assert.equal(h.calls.announce.length, 0);
    assert.ok(h.rows.get(ORDER).captured_at);
  });

  test('a refusal after another request finished the tip meanwhile is answered as a replay', async () => {
    const h = harness({ capture: ALREADY_CAPTURED });
    h.deps.getOrder = async () => {
      h.calls.getOrder++;
      h.rows.get(ORDER).captured_at = '2026-10-13 12:01:00'; // the other request finishes first
      throw new Error('fetch failed');
    };
    const result = await handleTipReturn({ streamer: STREAMER, orderId: ORDER }, h.deps);
    assert.deepEqual(result, { ok: true, replay: true });
    assert.equal(h.calls.announce.length, 0);
  });

  test('the tip cannot be recorded: nothing announced, the order stays open, and a reload recovers it', async () => {
    const h = harness();
    const logDonation = h.deps.logDonation;
    h.deps.logDonation = () => { h.calls.logDonation++; return null; }; // database error
    const first = await handleTipReturn({ streamer: STREAMER, orderId: ORDER }, h.deps);
    assert.deepEqual(first, { ok: false, reason: 'log_failed' });
    assert.equal(h.calls.announce.length, 0);
    assert.equal(h.rows.get(ORDER).captured_at, null, 'not marked, so a reload retries');
    h.deps.logDonation = logDonation;
    h.deps.capture = async () => { h.calls.capture++; return ALREADY_CAPTURED; };
    const reload = await handleTipReturn({ streamer: STREAMER, orderId: ORDER }, h.deps);
    assert.equal(reload.ok, true);
    assert.equal(reload.isNew, true);
    assert.equal(h.calls.announce.length, 1);
    assert.ok(h.rows.get(ORDER).captured_at);
  });
});

describe('tipErrorResponse', () => {
  test('maps each refusal to a status and a message key', () => {
    for (const reason of ['invalid_token', 'no_pending', 'streamer_mismatch']) {
      assert.deepEqual(tipErrorResponse(reason), { status: 400, key: 'tip.error.expired' }, reason);
    }
    for (const reason of ['not_completed', 'bad_amount', 'payee_mismatch']) {
      assert.deepEqual(tipErrorResponse(reason), { status: 400, key: 'tip.error.notConfirmed' }, reason);
    }
    assert.deepEqual(tipErrorResponse('capture_failed'), { status: 502, key: 'tip.error.notConfirmed' });
    assert.deepEqual(tipErrorResponse('log_failed'), { status: 500, key: 'tip.error.notRecorded' });
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
