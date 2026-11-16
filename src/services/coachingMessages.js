'use strict';

// The texts of the Discord messages a coaching booking sends (pure: `t` is
// (key, params) => string in the reader's language). Typed text (the viewer's
// name and note, the streamer's where text, the server's name) goes through
// escapeLinkText; the send itself adds allowedMentions: { parse: [] }.
//
// Viewer kinds: accepted (a free length, confirmed at once), acceptedPay (pay to confirm), confirmed (paid), declined,
// cancelled (with the coach's reason, and a refund line when a payment is owed), refunded, expired (not paid in time). Streamer kinds: request, withdrawn, paid, unpaid (not paid in time), paymentLate (a payment that
// arrived for a booking that could not take it: to be refunded in PayPal).

const { escapeLinkText } = require('../discord');

const GREEN = 0x3ecf8e;
const RED = 0xf04438;
const AMBER = 0xf5a524;

const discordTime = (ms) => `<t:${Math.floor(ms / 1000)}:F>`;

// An amount in cents as the reader's language writes it ("€25.00", "25,00 €"); "EUR 25.00" when the language or the
// currency is not one Intl knows.
function formatPrice(cents, currency, lang = 'en') {
  const amount = Number(cents) / 100;
  const code = typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : 'EUR';
  try {
    return new Intl.NumberFormat(lang, { style: 'currency', currency: code }).format(amount);
  } catch (e) {
    return `${code} ${amount.toFixed(2)}`;
  }
}

const VIEWER_COLORS = { accepted: GREEN, acceptedPay: AMBER, confirmed: GREEN, refunded: GREEN };

function viewerMessage(kind, { booking, streamerName, guildName, inviteUrl, whereText, bookingUrl, roomUrl, reason, refund, lang, t }) {
  const lines = [
    t('coaching.message.when', { time: discordTime(booking.starts_at) }),
    t('coaching.message.length', { minutes: booking.minutes }),
  ];
  if (kind === 'acceptedPay') {
    lines.push(t('coaching.message.price', { price: formatPrice(booking.price_cents, booking.currency, lang) }));
    if (booking.pay_by) lines.push(t('coaching.message.payBy', { time: discordTime(booking.pay_by) }));
    lines.push(t('coaching.message.payHere', { url: bookingUrl }));
  } else if (kind === 'accepted' || kind === 'confirmed') {
    if (kind === 'confirmed' && booking.paid_amount_cents != null) {
      lines.push(t('coaching.message.amountPaid', { price: formatPrice(booking.paid_amount_cents, booking.paid_currency, lang) }));
    }
    if (guildName) lines.push(t('coaching.message.server', { server: escapeLinkText(guildName) }));
    if (roomUrl) lines.push(t('coaching.message.room', { url: roomUrl }));
    else if (whereText) lines.push(t('coaching.message.where', { where: escapeLinkText(whereText) }));
    if (inviteUrl) lines.push(t('coaching.message.invite', { url: inviteUrl }));
  } else if (kind === 'refunded') {
    if (booking.paid_amount_cents != null) {
      lines.push(t('coaching.message.amountPaid', { price: formatPrice(booking.paid_amount_cents, booking.paid_currency, lang) }));
    }
    lines.push(t('coaching.message.refundedBody'));
  } else {
    if (kind === 'cancelled' && reason) lines.push(t('coaching.message.cancelReason', { reason: escapeLinkText(reason) }));
    if (kind === 'cancelled' && refund) lines.push(t('coaching.message.willRefund'));
    lines.push(t('coaching.message.pickAnother', { url: bookingUrl }));
  }
  return {
    embeds: [{
      title: t(`coaching.message.${kind}.title`, { streamer: streamerName }),
      description: lines.join('\n'),
      color: VIEWER_COLORS[kind] || RED,
    }],
  };
}

const STREAMER_COLORS = { request: GREEN, paid: GREEN, paymentLate: AMBER };

function streamerMessage(kind, { booking, scheduleUrl, lang, t }) {
  const name = escapeLinkText(booking.viewer_display_name || booking.viewer_username);
  const lines = [
    t('coaching.message.when', { time: discordTime(booking.starts_at) }),
    t('coaching.message.length', { minutes: booking.minutes }),
  ];
  if (kind === 'request') {
    if (booking.price_cents > 0) lines.push(t('coaching.message.price', { price: formatPrice(booking.price_cents, booking.currency, lang) }));
    if (booking.note) lines.push(t('coaching.message.note', { note: escapeLinkText(booking.note) }));
    lines.push(t('coaching.message.review', { url: scheduleUrl }));
  } else if (kind === 'paid') {
    lines.push(t('coaching.message.amountPaid', { price: formatPrice(booking.paid_amount_cents, booking.paid_currency, lang) }));
    lines.push(t('coaching.message.schedule', { url: scheduleUrl }));
  } else if (kind === 'paymentLate') {
    lines.push(t('coaching.message.amountPaid', { price: formatPrice(booking.paid_amount_cents, booking.paid_currency, lang) }));
    lines.push(t('coaching.message.refund'));
    lines.push(t('coaching.message.schedule', { url: scheduleUrl }));
  }
  return {
    embeds: [{
      title: t(`coaching.message.${kind}.title`, { viewer: name }),
      description: lines.join('\n'),
      color: STREAMER_COLORS[kind] || RED,
    }],
  };
}

module.exports = { discordTime, formatPrice, viewerMessage, streamerMessage };
