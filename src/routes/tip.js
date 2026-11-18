const { Router } = require('express');
const config = require('../config');
const db = require('../db');
const {
  tipInput, orderPayeeMerchantId, handleTipReturn, tipErrorResponse, reconcilePendingTips,
} = require('../services/tipCapture');
const { isStreamerDisabled } = require('../services/streamerAccess');
const { paypalClient } = require('../services/paypal');

const router = Router();

// --- PayPal API helpers (services/paypal.js) ---

const paypal = paypalClient(config.paypal);
const capturePayPalOrder = (orderId) => paypal.capture(orderId);
const getPayPalOrder = (orderId) => paypal.getOrder(orderId);

// --- Tip page rendering ---

// An account an admin disabled has no tip page: it answers like an unknown one.
function tipPageAvailable(streamer) {
  return !!(streamer && !isStreamerDisabled(streamer) && streamer.donation_page_enabled && streamer.paypal_email);
}

function renderTipPage(res, streamer, { status = 200, success = false, error = null } = {}) {
  res.status(status).render('tip', { streamer, avatarUrl: streamer.twitch_profile_image || null, success, error });
}

// The translated error for a refused return, on the tip page (or as plain text
// if the page has since been turned off). Every message in this file is shown to
// a viewer, so each one goes through res.locals.t (the visit's language).
function tipError(res, streamer, reason) {
  const { status, key } = tipErrorResponse(reason);
  const message = res.locals.t(key);
  if (!tipPageAvailable(streamer)) return res.status(status).send(message);
  renderTipPage(res, streamer, { status, error: message });
}

// A new PayPal donation: overlay alert, overlay stats, tip goal, trackers and chat thank-you. The overlay alert waits
// for its voice when the tip is read aloud (services/tipVoice.js, up to 15 s, one tip at a time per streamer); nothing
// here waits for it, so the viewer's return page and everything else stay immediate.
function announceTip(streamer, d) {
  try {
    const bus = require('../services/overlayBus');
    require('../services/tipVoice').announceWithVoice(streamer, d, {
      emitAlert: (tts) => bus.emit(`overlay:${streamer.id}`, {
        type: 'donation',
        data: { username: d.donorName, amount: d.amount, message: d.message, currency: d.currency, ...(tts ? { tts } : {}) },
      }),
    }).catch((e) => console.error('[Tip] Overlay alert error:', e.message));
  } catch (e) { console.error('[Tip] Overlay alert error:', e.message); }
  try { db.logOverlayEvent(streamer.id, 'donation', d.donorName, { amount: d.amount, currency: d.currency }); } catch (e) {}
  countTip(streamer, d);
  try {
    const { chatManager } = require('../services/twitchChat');
    chatManager.sendEventMessage(streamer.id, 'donation', {
      username: d.donorName,
      amount: `${d.currency} ${d.amount}`,
      message: d.message,
    });
  } catch (e) {}
}

// A tip just recorded in the donation history counts toward the tip goal and
// the trackers (Latest tip, Top tipper). Neither throws.
// A recovered tip (the daily reconcile, hours late) moves the goal without an `added` animation and only becomes the
// latest tip when it is newer than the stored one.
function countTip(streamer, d, opts) {
  const recovered = !!(opts && opts.recovered);
  require('../services/tipGoals').recordDonation(streamer.id, d.amount, d.currency, { silent: recovered, at: recovered ? opts.at : undefined });
  require('../services/trackers').onTip(streamer.id, { name: d.donorName, amount: d.amount, currency: d.currency }, recovered ? { recovered: true, at: opts.at } : undefined);
}

// A PayPal tip into the donation history: true for a new row, false if it was
// already there, null (not false) on a database error, so an error is never
// mistaken for a duplicate.
function logPayPalDonation(streamer, d) {
  try {
    return db.logDonation(streamer.id, {
      source: 'paypal', donor_name: d.donorName, amount: d.amount, currency: d.currency,
      message: d.message, external_id: d.orderId, created_at: d.createdAt,
    });
  } catch (e) {
    console.error('[Tip] logDonation error:', e.message);
    return null;
  }
}

function markTipCaptured(orderId) {
  try { db.markPendingTipCaptured(orderId); } catch (e) { console.error('[Tip] markPendingTipCaptured error:', e.message); }
}

// ─── Public tip page ──────────────────────────────────────────────────────────

router.get('/:username', (req, res) => {
  const streamer = db.getStreamerByUsername(req.params.username);
  if (!tipPageAvailable(streamer)) {
    return res.status(404).send(res.locals.t('tip.error.pageUnavailable'));
  }
  renderTipPage(res, streamer, { success: req.query.success === '1' });
});

// ─── Create PayPal order for tip ─────────────────────────────────────────────

router.post('/:username/create', async (req, res) => {
  const t = res.locals.t;
  const streamer = db.getStreamerByUsername(req.params.username);
  if (!tipPageAvailable(streamer)) {
    return res.status(404).send(t('tip.error.pageUnavailable'));
  }

  const body = req.body || {};
  const amount = parseFloat(body.amount);
  const minAmount = streamer.donation_min_amount || 1;
  const currency = streamer.donation_currency || 'EUR';
  const { donorName, message } = tipInput(body);

  if (isNaN(amount) || amount < minAmount) {
    return res.status(400).send(t('tip.error.invalidAmount'));
  }

  try {
    const order = await paypal.createOrder({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: currency, value: amount.toFixed(2) },
        // Shown to the donor at PayPal, so in the language they are reading this page in
        description: t('tip.paypalDescription', { name: streamer.twitch_display_name || streamer.twitch_username }),
        payee: { email_address: streamer.paypal_email },
      }],
      application_context: {
        return_url: `${config.app.url}/tip/${streamer.twitch_username}/success`,
        cancel_url: `${config.app.url}/tip/${streamer.twitch_username}`,
        brand_name: 'Atleta',
        user_action: 'PAY_NOW',
      },
    });

    const approveUrl = order.id && order.links?.find(l => l.rel === 'approve')?.href;
    if (approveUrl) {
      // The donor's name and message wait on the server, keyed by the order id,
      // until PayPal sends the viewer back to /success.
      db.createPendingTip({
        order_id: order.id,
        streamer_id: streamer.id,
        donor_name: donorName,
        message,
        payee_merchant_id: orderPayeeMerchantId(order),
        payee_email: streamer.paypal_email,
      });
      return res.redirect(approveUrl);
    }
    console.error('[Tip] PayPal order creation failed:', order);
    res.status(500).send(t('tip.error.paymentFailed'));
  } catch (e) {
    console.error('[Tip] PayPal error:', e.message);
    res.status(500).send(t('tip.error.paymentFailed'));
  }
});

// ─── PayPal return after payment — capture, then alert once ──────────────────

router.get('/:username/success', async (req, res) => {
  const streamer = db.getStreamerByUsername(req.params.username);
  if (!streamer) return res.status(404).send(res.locals.t('tip.error.streamerNotFound'));

  const orderId = typeof req.query.token === 'string' ? req.query.token : ''; // PayPal passes the order id as 'token'
  const validOrderId = /^[A-Z0-9-]{10,}$/i.test(orderId);
  // A disabled account answers like an unknown one, except for an order already
  // started on its page: that payment is still captured and recorded, so money
  // paid moments before the account was disabled is not lost.
  const disabled = isStreamerDisabled(streamer);
  if (disabled) {
    const pending = validOrderId ? db.getPendingTip(orderId) : null;
    if (!pending || Number(pending.streamer_id) !== Number(streamer.id)) return res.status(404).send(res.locals.t('tip.error.streamerNotFound'));
  }
  if (!validOrderId) return tipError(res, streamer, 'invalid_token');

  const result = await handleTipReturn({ streamer, orderId }, {
    getPendingTip: (id) => db.getPendingTip(id),
    capture: capturePayPalOrder,
    getOrder: getPayPalOrder,
    markCaptured: markTipCaptured,
    logDonation: (d) => logPayPalDonation(streamer, d),
    announce: (d) => announceTip(streamer, d),
  });

  if (!result.ok) {
    console.error(`[Tip] Order ${orderId} for ${streamer.twitch_username} not counted: ${result.reason}${result.detail ? ` (${result.detail})` : ''}`);
    return tipError(res, streamer, result.reason);
  }

  if (result.isNew) {
    const d = result.donation;
    console.log(`[Tip] Donation captured: ${d.donorName} → ${streamer.twitch_username} (${d.currency} ${d.amount}) message="${d.message}"`);
  } else if (!result.replay) {
    console.log(`[Tip] Order ${orderId} for ${streamer.twitch_username} was already in the donation history`);
  }
  // A disabled account has no tip page to go back to, so the viewer is thanked here.
  if (disabled) return renderTipPage(res, streamer, { success: true });
  res.redirect(`/tip/${streamer.twitch_username}?success=1`);
});

// ─── Daily reconcile, run by the donation cleanup in index.js ────────────────

// Tips PayPal captured that the return page never recorded are recorded and
// counted toward the goal and the trackers, without the alert or the chat
// thank-you (see reconcilePendingTips in services/tipCapture.js). Resolves to
// how many it recovered.
function reconcileTips() {
  return reconcilePendingTips({
    listUnfinished: (limit, offset) => db.getUnfinishedPendingTips(limit, offset),
    getStreamer: (id) => db.getStreamerById(id),
    getOrder: getPayPalOrder,
    logDonation: logPayPalDonation,
    markCaptured: markTipCaptured,
    recordGoal: countTip,
    log: (line) => console.log(line),
    logError: (line) => console.error(line),
  });
}

module.exports = router;
// Not a route: exported for the daily cleanup job.
module.exports.reconcilePendingTips = reconcileTips;
