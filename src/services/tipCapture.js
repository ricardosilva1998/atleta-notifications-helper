'use strict';

// PayPal tip page (/tip/:username) — the rules for turning PayPal's answer into a
// donation. While the viewer is at PayPal, the donor's name and message wait on
// the server in `pending_tips`, keyed by the PayPal order id. When PayPal sends
// the viewer back, the payment only counts if that row belongs to this streamer
// and PayPal says the money reached this streamer's PayPal account. The amount
// and currency always come from PayPal's capture, never from the browser.
//
// PayPal Orders v2 fields relied on (the route asks for the capture with
// `Prefer: return=representation`: the default minimal capture response has no
// payee, the full order representation does):
//   status                                    order status, must be COMPLETED
//   purchase_units[0].payments.captures[0]    .status, .amount.value, .amount.currency_code
//   purchase_units[0].payee                   .email_address and/or .merchant_id
// PayPal notes that a COMPLETED order can still hold a declined payment, so the
// capture's own status is checked too.

const DONOR_NAME_MAX = 50;
const MESSAGE_MAX = 200;

// PENDING means PayPal took the payment but is still settling it (for example
// an eCheck, a review, or the payee has to accept the currency). Such tips have
// always alerted, and still do; DECLINED and FAILED never do.
const COUNTED_CAPTURE_STATES = ['COMPLETED', 'PENDING'];

// One line of viewer text: control characters (line breaks included) become
// spaces, then it is trimmed and cut to `max` characters.
function cleanLine(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').trim().slice(0, max).trim();
}

// Donor name and message as typed on the tip page, ready to keep until capture.
function tipInput(body) {
  const b = body || {};
  return {
    donorName: cleanLine(b.donor_name, DONOR_NAME_MAX) || 'Anonymous',
    message: cleanLine(b.message, MESSAGE_MAX),
  };
}

// The PayPal account id PayPal names for the payee when it creates the order,
// if it names one. Kept so a capture that names the payee only by this id can
// still be checked.
function orderPayeeMerchantId(order) {
  const unit = order && Array.isArray(order.purchase_units) ? order.purchase_units[0] : null;
  const id = unit && unit.payee && unit.payee.merchant_id;
  return typeof id === 'string' && id.length > 0 && id.length <= 64 ? id : null;
}

function sameEmail(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = a.trim().toLowerCase();
  return x !== '' && x === b.trim().toLowerCase();
}

// Every identifier PayPal gives for the account that received the money must
// match this streamer, and at least one must be checkable: the email against
// the streamer's PayPal email, the merchant id against the one PayPal named
// when the order was created.
function payeeMatches(payee, streamer, pending) {
  if (!payee || typeof payee !== 'object') return false;
  let checked = false;
  if (payee.email_address) {
    if (!sameEmail(payee.email_address, streamer.paypal_email)) return false;
    checked = true;
  }
  if (payee.merchant_id && pending.payee_merchant_id) {
    if (payee.merchant_id !== pending.payee_merchant_id) return false;
    checked = true;
  }
  return checked;
}

// Before PayPal is called: can this return be tied to this streamer's tip page?
// Returns null when it can, else the reason. 'replay' means this order was
// already handled (the viewer reloaded the return URL).
function checkPendingTip(streamer, pending) {
  if (!pending) return 'no_pending';
  if (Number(pending.streamer_id) !== Number(streamer.id)) return 'streamer_mismatch';
  if (pending.captured_at) return 'replay';
  return null;
}

// Pure decision on PayPal's capture response. Returns
// { ok: true, donation: { orderId, donorName, message, amount, currency } }
// or { ok: false, reason }.
function decideTipCapture({ streamer, pending, capture }) {
  const early = checkPendingTip(streamer, pending);
  if (early) return { ok: false, reason: early };

  if (!capture || capture.status !== 'COMPLETED') return { ok: false, reason: 'not_completed' };
  const unit = Array.isArray(capture.purchase_units) ? capture.purchase_units[0] : null;
  const captures = unit && unit.payments && unit.payments.captures;
  const payment = Array.isArray(captures) ? captures[0] : null;
  if (!payment || !COUNTED_CAPTURE_STATES.includes(payment.status)) return { ok: false, reason: 'not_completed' };

  const amount = Number(payment.amount && payment.amount.value);
  const currency = payment.amount && payment.amount.currency_code;
  if (!Number.isFinite(amount) || amount <= 0 || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, reason: 'bad_amount' };
  }

  if (!payeeMatches(unit.payee, streamer, pending)) return { ok: false, reason: 'payee_mismatch' };

  return {
    ok: true,
    donation: {
      orderId: pending.order_id,
      donorName: pending.donor_name || 'Anonymous',
      message: pending.message || '',
      amount: Math.round(amount * 100) / 100,
      currency,
    },
  };
}

// What PayPal answered, for the server log — never payer details.
function paypalIssue(res) {
  if (!res || typeof res !== 'object') return '';
  if (res.name) {
    const issue = Array.isArray(res.details) && res.details[0] ? res.details[0].issue : '';
    return [res.name, issue, res.debug_id ? `debug_id=${res.debug_id}` : ''].filter(Boolean).join(' ');
  }
  const unit = Array.isArray(res.purchase_units) ? res.purchase_units[0] : null;
  const captures = unit && unit.payments && unit.payments.captures;
  const payment = Array.isArray(captures) ? captures[0] : null;
  return [`order=${res.status || '?'}`, payment ? `capture=${payment.status || '?'}` : ''].filter(Boolean).join(' ');
}

// The viewer's return from PayPal, start to finish. Every outside effect comes
// in through `deps`, so this runs in tests without PayPal or a database:
//   getPendingTip(orderId)   -> pending_tips row or null
//   capture(orderId)         -> PayPal's capture response (may throw)
//   markCaptured(orderId)    -> remember the order was handled (reloads become no-ops)
//   logDonation(donation)    -> true only when a new donation row was written
//   announce(donation)       -> overlay alert, chat thank-you and tip goal
// The alert, chat and goal only happen for a new donation row, so a capture
// that is handled twice is announced once.
async function handleTipReturn({ streamer, orderId }, deps) {
  const pending = deps.getPendingTip(orderId);
  const early = checkPendingTip(streamer, pending);
  if (early === 'replay') return { ok: true, replay: true };
  if (early) return { ok: false, reason: early };

  let capture;
  try {
    capture = await deps.capture(orderId);
  } catch (e) {
    return { ok: false, reason: 'capture_failed', detail: e.message };
  }

  const verdict = decideTipCapture({ streamer, pending, capture });
  if (!verdict.ok) return { ok: false, reason: verdict.reason, detail: paypalIssue(capture) };

  deps.markCaptured(orderId);
  const isNew = deps.logDonation(verdict.donation) === true;
  if (isNew) deps.announce(verdict.donation);
  return { ok: true, isNew, donation: verdict.donation };
}

module.exports = {
  tipInput,
  orderPayeeMerchantId,
  checkPendingTip,
  decideTipCapture,
  handleTipReturn,
  paypalIssue,
  DONOR_NAME_MAX,
  MESSAGE_MAX,
};
