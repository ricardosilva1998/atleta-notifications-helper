'use strict';

// The texts of the Discord messages a coaching booking sends (pure: `t` is
// (key, params) => string in the reader's language). Typed text (the viewer's
// name and note, the streamer's where text, the server's name) goes through
// escapeLinkText; the send itself adds allowedMentions: { parse: [] }.

const { escapeLinkText } = require('../discord');

const GREEN = 0x3ecf8e;
const RED = 0xf04438;

const discordTime = (ms) => `<t:${Math.floor(ms / 1000)}:F>`;

function viewerMessage(kind, { booking, streamerName, guildName, inviteUrl, whereText, bookingUrl, t }) {
  const lines = [
    t('coaching.message.when', { time: discordTime(booking.starts_at) }),
    t('coaching.message.length', { minutes: booking.minutes }),
  ];
  if (kind === 'accepted') {
    if (guildName) lines.push(t('coaching.message.server', { server: escapeLinkText(guildName) }));
    if (whereText) lines.push(t('coaching.message.where', { where: escapeLinkText(whereText) }));
    if (inviteUrl) lines.push(t('coaching.message.invite', { url: inviteUrl }));
  } else {
    lines.push(t('coaching.message.pickAnother', { url: bookingUrl }));
  }
  return {
    embeds: [{
      title: t(`coaching.message.${kind}.title`, { streamer: streamerName }),
      description: lines.join('\n'),
      color: kind === 'accepted' ? GREEN : RED,
    }],
  };
}

function streamerMessage(kind, { booking, scheduleUrl, t }) {
  const name = escapeLinkText(booking.viewer_display_name || booking.viewer_username);
  const lines = [
    t('coaching.message.when', { time: discordTime(booking.starts_at) }),
    t('coaching.message.length', { minutes: booking.minutes }),
  ];
  if (kind === 'request') {
    if (booking.note) lines.push(t('coaching.message.note', { note: escapeLinkText(booking.note) }));
    lines.push(t('coaching.message.review', { url: scheduleUrl }));
  }
  return {
    embeds: [{
      title: t(`coaching.message.${kind}.title`, { viewer: name }),
      description: lines.join('\n'),
      color: kind === 'request' ? GREEN : RED,
    }],
  };
}

module.exports = { discordTime, viewerMessage, streamerMessage };
