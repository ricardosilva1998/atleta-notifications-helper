'use strict';

// PayPal Orders v2 for the tip page (routes/tip.js) and coaching payments (services/coachingPayments.js): an access
// token, a new order, its capture and a read of the order. The caller hands in config.paypal ({ clientId, clientSecret,
// baseUrl }); it is read on each call. The decisions about what PayPal answered are the callers' (tipCapture.js,
// coachingPayments.js), never made here.

// A PayPal call gives up after this long instead of holding the viewer's request open.
const PAYPAL_TIMEOUT_MS = 15000;

function paypalClient(conf) {
  const settings = () => conf || {};
  const orderUrl = (orderId) => `${settings().baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`;

  async function getToken() {
    const { clientId, clientSecret, baseUrl } = settings();
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(PAYPAL_TIMEOUT_MS),
    });
    const data = await res.json();
    if (!data.access_token) throw new Error(`PayPal token request failed (HTTP ${res.status})`);
    return data.access_token;
  }

  // A new order; `body` is the Orders v2 request. return=representation: the reply names the payee
  // (purchase_units[0].payee), which the callers keep. Resolves to PayPal's answer as it is (no id when refused).
  async function createOrder(body) {
    const token = await getToken();
    const res = await fetch(`${settings().baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PAYPAL_TIMEOUT_MS),
    });
    return res.json();
  }

  // `Prefer: return=representation` returns the whole order. The default minimal capture response has no
  // purchase_units[0].payee, which the payee check needs. A PayPal server error leaves the outcome unknown, so it
  // throws like a timeout and the caller reads the order instead.
  async function capture(orderId) {
    const token = await getToken();
    const res = await fetch(`${orderUrl(orderId)}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      signal: AbortSignal.timeout(PAYPAL_TIMEOUT_MS),
    });
    if (res.status >= 500) throw new Error(`PayPal capture failed (HTTP ${res.status})`);
    return res.json();
  }

  // The order as PayPal has it now (the full order, payee and captures included).
  async function getOrder(orderId) {
    const token = await getToken();
    const res = await fetch(orderUrl(orderId), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(PAYPAL_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`PayPal order lookup failed (HTTP ${res.status})`);
    return res.json();
  }

  return { getToken, createOrder, capture, getOrder };
}

// The link PayPal sends the buyer to, from a created order; null when there is none.
function approveUrlOf(order) {
  if (!order || !order.id || !Array.isArray(order.links)) return null;
  const link = order.links.find((l) => l && l.rel === 'approve') || order.links.find((l) => l && l.rel === 'payer-action');
  return link && typeof link.href === 'string' ? link.href : null;
}

module.exports = { paypalClient, approveUrlOf, PAYPAL_TIMEOUT_MS };
