'use strict';

// The texts of the Discord messages a coaching booking sends (pure: `t` is
// (key, params) => string in the reader's language). Typed text (the viewer's
// name and note, the streamer's where text, the server's name) goes through
// escapeLinkText; the send itself adds allowedMentions: { parse: [] }.
//
// Viewer kinds: accepted (a free length, confirmed at once), acceptedPay (pay to confirm), confirmed (paid), declined,
// cancelled (with the coach's reason, and a refund line when a payment is owed), refunded, expired (not paid in time). Streamer kinds: request, withdrawn, paid, unpaid (not paid in time), paymentLate (a payment that
// arrived for a booking that could not take it: to be refunded in PayPal).
// Reschedule: viewer kinds rescheduleProposed (the coach proposed a time), rescheduleAsk (the viewer picks), proposal (a new
// coach proposal), rescheduleAgreed, proposalLapsed (pick a time), notRescheduled; streamer kinds viewerProposed,
// agreedCoach, viewerLapsed, notRescheduledCoach.

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

const VIEWER_COLORS = {
  accepted: GREEN, acceptedPay: AMBER, confirmed: GREEN, refunded: GREEN, duplicateRefunded: GREEN, paymentLateViewer: AMBER,
  rescheduleProposed: AMBER, rescheduleAsk: AMBER, proposal: AMBER, rescheduleAgreed: GREEN, proposalLapsed: AMBER,
};
const VIEWER_RESCHEDULE = ['rescheduleProposed', 'rescheduleAsk', 'proposal', 'rescheduleAgreed', 'proposalLapsed', 'notRescheduled'];

// A session's time while it moves: `starts_at` is still the original one until a proposal is accepted.
function rescheduleLines(kind, { booking, t, bookingLink, roomUrl, guildName, refund, side }) {
  const lines = [t('coaching.message.length', { minutes: booking.minutes })];
  const proposed = booking.proposal_starts_at != null ? t('coaching.message.proposedTime', { time: discordTime(booking.proposal_starts_at) }) : null;
  const note = booking.proposal_note ? t('coaching.message.note', { note: escapeLinkText(booking.proposal_note) }) : null;
  if (kind === 'rescheduleAgreed' || kind === 'agreedCoach') {
    lines.push(t('coaching.message.newTime', { time: discordTime(booking.starts_at) }));
    if (kind === 'rescheduleAgreed') {
      if (guildName) lines.push(t('coaching.message.server', { server: escapeLinkText(guildName) }));
      if (roomUrl) lines.push(t('coaching.message.room', { url: roomUrl }));
    }
    return lines;
  }
  lines.push(t('coaching.message.originalTime', { time: discordTime(booking.original_starts_at != null ? booking.original_starts_at : booking.starts_at) }));
  if (kind === 'rescheduleProposed' || kind === 'proposal' || kind === 'viewerProposed') {
    if (proposed) lines.push(proposed);
    if (note) lines.push(note);
    lines.push(side === 'coach' ? t('coaching.message.schedule', { url: bookingLink }) : t('coaching.message.proposalBody', { url: bookingLink }));
  } else if (kind === 'rescheduleAsk') {
    lines.push(t('coaching.message.rescheduleAskBody', { url: bookingLink }));
  } else if (kind === 'proposalLapsed') {
    lines.push(t('coaching.message.proposalLapsedBody'));
    lines.push(t('coaching.message.rescheduleAskBody', { url: bookingLink }));
  } else if (kind === 'viewerLapsed') {
    lines.push(t('coaching.message.viewerLapsedBody'));
    lines.push(t('coaching.message.schedule', { url: bookingLink }));
  } else if (kind === 'notRescheduled' || kind === 'notRescheduledCoach') {
    lines.push(t('coaching.message.notRescheduledBody'));
    if (refund) lines.push(kind === 'notRescheduled' ? t('coaching.message.willRefund') : t('coaching.message.refundPendingCoach'));
    if (kind === 'notRescheduledCoach') lines.push(t('coaching.message.schedule', { url: bookingLink }));
  }
  return lines;
}

function viewerMessage(kind, { booking, streamerName, guildName, inviteUrl, whereText, bookingUrl, bookingLink, myBookingsUrl, roomUrl, reason, refund, lang, t }) {
  // The action lines of these kinds (pay, accept, pick a time) link to My bookings themselves: no second link line.
  const actionHere = myBookingsUrl || bookingLink || bookingUrl;
  const actionKinds = ['acceptedPay', 'rescheduleProposed', 'rescheduleAsk', 'proposal', 'proposalLapsed'];
  const mine = myBookingsUrl && !actionKinds.includes(kind) ? [t('coaching.message.myBookings', { url: myBookingsUrl })] : [];
  if (VIEWER_RESCHEDULE.includes(kind)) {
    return {
      embeds: [{
        title: t(`coaching.message.${kind}.title`, { streamer: streamerName }),
        description: rescheduleLines(kind, { booking, t, bookingLink: actionHere, roomUrl, guildName, refund, side: 'viewer' }).concat(mine).join('\n'),
        color: VIEWER_COLORS[kind] || RED,
      }],
    };
  }
  const lines = [
    t('coaching.message.when', { time: discordTime(booking.starts_at) }),
    t('coaching.message.length', { minutes: booking.minutes }),
  ];
  if (kind === 'acceptedPay') {
    lines.push(t('coaching.message.price', { price: formatPrice(booking.price_cents, booking.currency, lang) }));
    if (booking.pay_by) lines.push(t('coaching.message.payBy', { time: discordTime(booking.pay_by) }));
    lines.push(t('coaching.message.payHere', { url: actionHere }));
  } else if (kind === 'accepted' || kind === 'confirmed') {
    if (kind === 'confirmed' && booking.paid_amount_cents != null) {
      lines.push(t('coaching.message.amountPaid', { price: formatPrice(booking.paid_amount_cents, booking.paid_currency, lang) }));
    }
    if (guildName) lines.push(t('coaching.message.server', { server: escapeLinkText(guildName) }));
    if (roomUrl) lines.push(t('coaching.message.room', { url: roomUrl }));
    else if (whereText) lines.push(t('coaching.message.where', { where: escapeLinkText(whereText) }));
    if (inviteUrl) lines.push(t('coaching.message.invite', { url: inviteUrl }));
  } else if (kind === 'paymentLateViewer') {
    lines.push(t('coaching.message.paymentLateViewerBody', { streamer: streamerName }));
  } else if (kind === 'duplicateRefunded') {
    lines.push(t('coaching.message.duplicateRefundedBody'));
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
      description: lines.concat(mine).join('\n'),
      color: VIEWER_COLORS[kind] || RED,
    }],
  };
}

const STREAMER_COLORS = { request: GREEN, paid: GREEN, paymentLate: AMBER, viewerProposed: AMBER, agreedCoach: GREEN, viewerLapsed: AMBER };
const STREAMER_RESCHEDULE = ['viewerProposed', 'agreedCoach', 'viewerLapsed', 'notRescheduledCoach'];

function streamerMessage(kind, { booking, scheduleUrl, lang, refund, t }) {
  const name = escapeLinkText(booking.viewer_display_name || booking.viewer_username);
  if (STREAMER_RESCHEDULE.includes(kind)) {
    return {
      embeds: [{
        title: t(`coaching.message.${kind}.title`, { viewer: name }),
        description: rescheduleLines(kind, { booking, t, bookingLink: scheduleUrl, refund, side: 'coach' }).join('\n'),
        color: STREAMER_COLORS[kind] || RED,
      }],
    };
  }
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
