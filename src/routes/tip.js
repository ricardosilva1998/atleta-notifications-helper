const { Router } = require('express');
const config = require('../config');
const db = require('../db');
const { tipInput, orderPayeeMerchantId, handleTipReturn } = require('../services/tipCapture');

const router = Router();

// --- PayPal API helpers ---

// A PayPal call gives up after this long instead of holding the viewer's request open.
const PAYPAL_TIMEOUT_MS = 15000;

async function getPayPalToken() {
  const auth = Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString('base64');
  const res = await fetch(`${config.paypal.baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(PAYPAL_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`PayPal token request failed (HTTP ${res.status})`);
  return data.access_token;
}

// `Prefer: return=representation` returns the whole order. The default minimal
// capture response has no purchase_units[0].payee, which the payee check needs.
async function capturePayPalOrder(orderId) {
  const token = await getPayPalToken();
  const res = await fetch(`${config.paypal.baseUrl}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    signal: AbortSignal.timeout(PAYPAL_TIMEOUT_MS),
  });
  return res.json();
}

// --- Tip page rendering ---

function tipPageAvailable(streamer) {
  return !!(streamer && streamer.donation_page_enabled && streamer.paypal_email);
}

function renderTipPage(res, streamer, { status = 200, success = false, error = null } = {}) {
  res.status(status).render('tip', { streamer, avatarUrl: streamer.twitch_profile_image || null, success, error });
}

// A translated error on the tip page (or as plain text if the page has since been turned off).
function tipError(res, streamer, status, key) {
  const message = res.locals.t(key);
  if (!tipPageAvailable(streamer)) return res.status(status).send(message);
  renderTipPage(res, streamer, { status, error: message });
}

// A new PayPal donation: overlay alert, overlay stats, tip goal and chat thank-you.
function announceTip(streamer, d) {
  try {
    require('../services/overlayBus').emit(`overlay:${streamer.id}`, {
      type: 'donation',
      data: { username: d.donorName, amount: d.amount, message: d.message, currency: d.currency },
    });
  } catch (e) { console.error('[Tip] Overlay alert error:', e.message); }
  try { db.logOverlayEvent(streamer.id, 'donation', d.donorName, { amount: d.amount, currency: d.currency }); } catch (e) {}
  require('../services/tipGoals').recordDonation(streamer.id, d.amount, d.currency);
  try {
    const { chatManager } = require('../services/twitchChat');
    chatManager.sendEventMessage(streamer.id, 'donation', {
      username: d.donorName,
      amount: `${d.currency} ${d.amount}`,
      message: d.message,
    });
  } catch (e) {}
}

// ─── Public tip page ──────────────────────────────────────────────────────────

router.get('/:username', (req, res) => {
  const streamer = db.getStreamerByUsername(req.params.username);
  if (!tipPageAvailable(streamer)) {
    return res.status(404).send('Donation page not available.');
  }
  renderTipPage(res, streamer, { success: req.query.success === '1' });
});

// ─── Create PayPal order for tip ─────────────────────────────────────────────

router.post('/:username/create', async (req, res) => {
  const streamer = db.getStreamerByUsername(req.params.username);
  if (!tipPageAvailable(streamer)) {
    return res.status(404).send('Donation page not available.');
  }

  const body = req.body || {};
  const amount = parseFloat(body.amount);
  const minAmount = streamer.donation_min_amount || 1;
  const currency = streamer.donation_currency || 'EUR';
  const { donorName, message } = tipInput(body);

  if (isNaN(amount) || amount < minAmount) {
    return res.status(400).send('Invalid amount.');
  }

  try {
    const token = await getPayPalToken();
    const orderRes = await fetch(`${config.paypal.baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      // return=representation: the reply names the payee (purchase_units[0].payee), kept below
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: currency, value: amount.toFixed(2) },
          description: `Donation to ${streamer.twitch_display_name || streamer.twitch_username}`,
          payee: { email_address: streamer.paypal_email },
        }],
        application_context: {
          return_url: `${config.app.url}/tip/${streamer.twitch_username}/success`,
          cancel_url: `${config.app.url}/tip/${streamer.twitch_username}`,
          brand_name: 'Atleta',
          user_action: 'PAY_NOW',
        },
      }),
      signal: AbortSignal.timeout(PAYPAL_TIMEOUT_MS),
    });
    const order = await orderRes.json();

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
      });
      return res.redirect(approveUrl);
    }
    console.error('[Tip] PayPal order creation failed:', order);
    res.status(500).send('Payment error. Please try again.');
  } catch (e) {
    console.error('[Tip] PayPal error:', e.message);
    res.status(500).send('Payment error. Please try again.');
  }
});

// ─── PayPal return after payment — capture, then alert once ──────────────────

router.get('/:username/success', async (req, res) => {
  const streamer = db.getStreamerByUsername(req.params.username);
  if (!streamer) return res.status(404).send('Streamer not found.');

  const orderId = typeof req.query.token === 'string' ? req.query.token : ''; // PayPal passes the order id as 'token'
  if (!/^[A-Z0-9-]{10,}$/i.test(orderId)) return tipError(res, streamer, 400, 'tip.error.expired');

  const result = await handleTipReturn({ streamer, orderId }, {
    getPendingTip: (id) => db.getPendingTip(id),
    capture: capturePayPalOrder,
    markCaptured: (id) => {
      try { db.markPendingTipCaptured(id); } catch (e) { console.error('[Tip] markPendingTipCaptured error:', e.message); }
    },
    logDonation: (d) => {
      try {
        return db.logDonation(streamer.id, {
          source: 'paypal', donor_name: d.donorName, amount: d.amount, currency: d.currency,
          message: d.message, external_id: d.orderId,
        });
      } catch (e) {
        console.error('[Tip] logDonation error:', e.message);
        return false;
      }
    },
    announce: (d) => announceTip(streamer, d),
  });

  if (!result.ok) {
    console.error(`[Tip] Order ${orderId} for ${streamer.twitch_username} not counted: ${result.reason}${result.detail ? ` (${result.detail})` : ''}`);
    const beforePayPal = result.reason === 'no_pending' || result.reason === 'streamer_mismatch';
    return tipError(res, streamer, result.reason === 'capture_failed' ? 502 : 400,
      beforePayPal ? 'tip.error.expired' : 'tip.error.notConfirmed');
  }

  if (result.isNew) {
    const d = result.donation;
    console.log(`[Tip] Donation captured: ${d.donorName} → ${streamer.twitch_username} (${d.currency} ${d.amount}) message="${d.message}"`);
  } else if (!result.replay) {
    console.log(`[Tip] Order ${orderId} for ${streamer.twitch_username} was already in the donation history`);
  }
  res.redirect(`/tip/${streamer.twitch_username}?success=1`);
});

module.exports = router;
