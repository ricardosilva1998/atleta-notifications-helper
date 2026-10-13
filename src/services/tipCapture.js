'use strict';

// PayPal tip page (/tip/:username) — the rules for turning PayPal's answer into a
// donation. While the viewer is at PayPal, the donor's name and message wait on
// the server in `pending_tips`, keyed by the PayPal order id. When PayPal sends
// the viewer back, the payment only counts if that row belongs to this streamer
// and PayPal says the money reached this streamer's PayPal account. The amount
// and currency always come from PayPal's capture, never from the browser.
//
// PayPal Orders v2 fields relied on, in the capture response (the route asks for
// it with `Prefer: return=representation`: the default minimal capture response
// has no payee, the full order does) and in the order read (GET) used whenever
// the capture answer is not a completed order, and by the daily reconcile pass:
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

// Did the money reach this streamer's PayPal account? The account id PayPal
// named for the payee when the order was created is the strongest proof, so
// when it was recorded and PayPal names an account id now, the two must be the
// same account (the email PayPal shows can be another address of that account).
// Otherwise the payee email must match the streamer's PayPal email.
function payeeMatches(payee, streamer, pending) {
  if (!payee || typeof payee !== 'object') return false;
  if (pending.payee_merchant_id && payee.merchant_id) return payee.merchant_id === pending.payee_merchant_id;
  return sameEmail(payee.email_address, streamer.paypal_email);
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

// PayPal's answer while another capture request for the same order is still
// running (a reload that raced the first request): the outcome is not known yet.
function isCaptureInProgress(res) {
  return !!(res && Array.isArray(res.details) && res.details.some((d) => d && d.issue === 'PREVIOUS_REQUEST_IN_PROGRESS'));
}

// The page a refused return gets: HTTP status and locale key. Before PayPal is
// called the link is just not usable. Afterwards PayPal refused the payment
// (notConfirmed), its outcome is not known yet (capture_failed: the page asks
// for a reload, which finishes an approved order or reads back a captured one,
// and never for a new payment), or (log_failed) PayPal took it but the tip could
// not be recorded yet.
function tipErrorResponse(reason) {
  switch (reason) {
    case 'invalid_token':
    case 'no_pending':
    case 'streamer_mismatch':
      return { status: 400, key: 'tip.error.expired' };
    case 'capture_failed':
      return { status: 502, key: 'tip.error.notConfirmedYet' };
    case 'log_failed':
      return { status: 500, key: 'tip.error.notRecorded' };
    default:
      return { status: 400, key: 'tip.error.notConfirmed' };
  }
}

// The viewer's return from PayPal, start to finish. Every outside effect comes
// in through `deps`, so this runs in tests without PayPal or a database:
//   getPendingTip(orderId)   -> pending_tips row or null
//   capture(orderId)         -> PayPal's capture response; throws when the outcome
//                               is unknown (network error, timeout, PayPal 5xx)
//   getOrder(orderId)        -> the order as PayPal has it now (may throw)
//   logDonation(donation)    -> true for a new donation row, false for one already
//                               there, null when it could not be written
//   markCaptured(orderId)    -> remember the order was handled (reloads become no-ops)
//   announce(donation)       -> overlay alert, chat thank-you and tip goal
// The alert, chat and goal only happen for a new donation row. That row is
// unique per PayPal order, so the tip is announced exactly once even when two
// requests handle the same order.
async function handleTipReturn({ streamer, orderId }, deps) {
  const pending = deps.getPendingTip(orderId);
  const early = checkPendingTip(streamer, pending);
  if (early === 'replay') return { ok: true, replay: true };
  if (early) return { ok: false, reason: early };

  let answer = null;
  let failure = null;
  try {
    answer = await deps.capture(orderId);
  } catch (e) {
    failure = e.message;
  }
  // Anything but a completed order leaves room for doubt: the capture may have
  // gone through anyway (its answer lost or timed out, the order captured
  // already, or a reload racing the first request). Then the order itself says
  // what was paid, so a real tip is never lost.
  let order = answer;
  if (failure || !answer || answer.status !== 'COMPLETED') {
    try {
      order = await deps.getOrder(orderId);
    } catch (e) {
      order = null;
      failure = failure || e.message;
    }
  }

  const verdict = decideTipCapture({ streamer, pending, capture: order });
  if (!verdict.ok) {
    // A request for the same order (a reload) may have finished it meanwhile.
    const now = deps.getPendingTip(orderId);
    if (now && now.captured_at) return { ok: true, replay: true };
    // Not captured, but not settled either: PayPal could not be asked, or was
    // still capturing for another request. A reload finishes it or reads it back.
    const unsettled = !!failure || isCaptureInProgress(answer);
    const reason = unsettled && verdict.reason === 'not_completed' ? 'capture_failed' : verdict.reason;
    return { ok: false, reason, detail: [paypalIssue(answer), failure].filter(Boolean).join('; ') };
  }

  const isNew = deps.logDonation(verdict.donation);
  // Not recorded: the order stays unmarked, so a reload comes back through the
  // order read above and records it then. No alert without a new row.
  if (isNew !== true && isNew !== false) return { ok: false, reason: 'log_failed' };
  deps.markCaptured(orderId);
  if (isNew) deps.announce(verdict.donation);
  return { ok: true, isNew, donation: verdict.donation };
}

// Daily, before old pending rows are deleted: tips PayPal captured that the
// return page never recorded (the capture answer was lost and the viewer did not
// reload). Every unfinished row at least an hour old gets one order read; a
// captured order that passes the same checks as the return page is recorded and
// counted toward the tip goal, without the overlay alert or the chat thank-you
// (hours later they would be stale). Anything else is left as it is, and a
// failure only skips its own row.
//   listUnfinished()           -> pending rows without captured_at, at least 1 h old
//   getStreamer(id)            -> the streamer row, or null
//   getOrder(orderId)          -> the order as PayPal has it now (may throw)
//   logDonation(streamer, d)   -> true / false / null, as for handleTipReturn
//   markCaptured(orderId)
//   recordGoal(streamer, d)    -> tip goal progress
//   log(line), logError(line)
// Returns how many tips it recovered.
async function reconcilePendingTips(deps) {
  let recovered = 0;
  for (const pending of deps.listUnfinished()) {
    try {
      const streamer = deps.getStreamer(pending.streamer_id);
      if (!streamer) continue;
      const order = await deps.getOrder(pending.order_id);
      const verdict = decideTipCapture({ streamer, pending, capture: order });
      if (!verdict.ok) continue;
      const isNew = deps.logDonation(streamer, verdict.donation);
      if (isNew !== true && isNew !== false) {
        deps.logError(`[Tip] Reconcile: order ${pending.order_id} could not be recorded; left for the next run`);
        continue;
      }
      deps.markCaptured(pending.order_id);
      if (!isNew) continue;
      deps.recordGoal(streamer, verdict.donation);
      recovered++;
      const d = verdict.donation;
      deps.log(`[Tip] Recovered order ${pending.order_id} for ${streamer.twitch_username}: ${d.currency} ${d.amount} from ${d.donorName}, recorded without an alert`);
    } catch (e) {
      deps.logError(`[Tip] Reconcile: order ${pending.order_id} failed: ${e.message}`);
    }
  }
  return recovered;
}

module.exports = {
  tipInput,
  orderPayeeMerchantId,
  checkPendingTip,
  decideTipCapture,
  handleTipReturn,
  paypalIssue,
  tipErrorResponse,
  reconcilePendingTips,
  DONOR_NAME_MAX,
  MESSAGE_MAX,
};
