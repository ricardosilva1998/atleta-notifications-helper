'use strict';

// The settings a dashboard card saves one at a time (POST /dashboard/settings). Only the keys in SETTINGS are
// accepted. Each entry says how its value is read (kind), which database function writes it (writer), what
// `guildId` or `id` names (target), what must be in place to switch it on (needs) and what must follow the
// write (after). The route passes in the database and the follow-ups, so this module is tested without them.
// Kinds: 'switch', 'int' and 'number' (min to max), 'choice' (one of its choices), 'text' (trimmed, up to max; empty only with allowEmpty).

const { parseSwitch, SPONSOR_CHAT_INTERVAL_MINUTES } = require('./inputLimits');
const { DURATIONS } = require('./overlaySettings');
const { CHAT_TEXTS: POLL_TEXTS } = require('./pollRules');
const { RAID_MIN_VIEWERS } = require('./shoutouts');

const TEMPLATE_MAX = 500;
const BATCH_MAX = 20;

const THANK_YOUS = ['follow', 'sub', 'giftsub', 'bits', 'donation', 'raid'];
const BUILTINS = ['followage', 'subage', 'uptime', 'accountage', '8ball', 'roll', 'hug', 'slap', 'love', 'rps', 'coinflip', 'quote', 'roast'];
const FILTERS = ['link_protection', 'banned_words', 'caps', 'emote_spam', 'repetition', 'symbol_spam'];
const ALERTS = ['follow', 'sub', 'bits', 'donation', 'raid', 'giveaway'];

const entries = (names, entry) => Object.fromEntries(names.map((name) => [name, Object.freeze({ ...entry })]));

const SETTINGS = Object.freeze({
  chatbot_enabled: Object.freeze({ kind: 'switch', writer: 'chatbot', after: ['connections'] }),
  ...entries(THANK_YOUS.map((e) => `chat_${e}_enabled`), { kind: 'switch', writer: 'chatbot' }),
  ...entries(THANK_YOUS.map((e) => `chat_${e}_template`), { kind: 'text', max: TEMPLATE_MAX, writer: 'chatbot' }),
  ...entries(BUILTINS.map((c) => `cmd_${c}_enabled`), { kind: 'switch', writer: 'builtins' }),
  ...entries(FILTERS.map((f) => `mod_${f}_enabled`), { kind: 'switch', writer: 'moderation' }),
  overlay_enabled: Object.freeze({ kind: 'switch', writer: 'overlay', after: ['connections', 'overlay'] }),
  ...entries(ALERTS.map((a) => `overlay_${a}_enabled`), { kind: 'switch', writer: 'overlay', after: ['overlay'] }),
  ...Object.fromEntries(DURATIONS.map(([column, , longest]) => [column, Object.freeze({ kind: 'int', min: 1, max: longest, writer: 'overlay', after: ['overlay'] })])),
  overlay_volume: Object.freeze({ kind: 'number', min: 0, max: 1, writer: 'overlay', after: ['overlay'] }),
  sponsor_send_chat: Object.freeze({ kind: 'switch', writer: 'sponsorChat', after: ['sponsorChat'] }),
  sponsor_chat_interval_minutes: Object.freeze({ kind: 'int', min: SPONSOR_CHAT_INTERVAL_MINUTES.min, max: SPONSOR_CHAT_INTERVAL_MINUTES.max, writer: 'sponsorChat', after: ['sponsorChat'] }),
  donation_page_enabled: Object.freeze({ kind: 'switch', writer: 'donations', needs: 'paypalEmail' }),
  // Reading tips aloud: offered only while the site has an ElevenLabs key (`ttsAvailable`, given by the route).
  tts_enabled: Object.freeze({ kind: 'switch', writer: 'tts', needs: 'ttsAvailable' }),
  cp_rewards_enabled: Object.freeze({ kind: 'switch', writer: 'overlay' }),
  recap_enabled: Object.freeze({ kind: 'switch', target: 'guild', writer: 'guild' }),
  milestones_enabled: Object.freeze({ kind: 'switch', target: 'guild', writer: 'guild' }),
  weekly_highlights_enabled: Object.freeze({ kind: 'switch', target: 'guild', writer: 'guild' }),
  sub_sync_enabled: Object.freeze({ kind: 'switch', target: 'guild', writer: 'guild', needs: 'subRole' }),
  notify_live: Object.freeze({ kind: 'switch', target: 'watcher', writer: 'watcher', needs: 'liveChannel' }),
  notify_clips: Object.freeze({ kind: 'switch', target: 'watcher', writer: 'watcher', needs: 'clipsChannel' }),
  sponsor_message_enabled: Object.freeze({ kind: 'switch', target: 'sponsorMessage', writer: 'sponsorMessage', after: ['sponsorChat'] }),
  // The Polls & predictions card: a poll or prediction text left empty posts nothing for that moment.
  polls_chat_enabled: Object.freeze({ kind: 'switch', writer: 'polls' }),
  ...entries(POLL_TEXTS.map((text) => text.key), { kind: 'text', max: TEMPLATE_MAX, allowEmpty: true, writer: 'polls' }),
  // The Shoutouts card.
  shoutout_command_enabled: Object.freeze({ kind: 'switch', writer: 'shoutouts' }),
  shoutout_raid_enabled: Object.freeze({ kind: 'switch', writer: 'shoutouts' }),
  shoutout_raid_min_viewers: Object.freeze({ kind: 'choice', choices: RAID_MIN_VIEWERS, writer: 'shoutouts' }),
  shoutout_template: Object.freeze({ kind: 'text', max: TEMPLATE_MAX, writer: 'shoutouts' }),
});

// A refusal: its HTTP status and the text the card shows.
const ERRORS = Object.freeze({
  invalid: Object.freeze({ status: 400, text: 'dashboard.settings.error.invalid' }),
  required: Object.freeze({ status: 400, text: 'dashboard.settings.error.required' }),
  too_long: Object.freeze({ status: 400, text: 'dashboard.settings.error.tooLong' }),
  not_found: Object.freeze({ status: 404, text: 'dashboard.settings.error.notFound' }),
  no_email: Object.freeze({ status: 409, text: 'dashboard.settings.error.noEmail' }),
  no_role: Object.freeze({ status: 409, text: 'dashboard.settings.error.noRole' }),
  no_channel: Object.freeze({ status: 409, text: 'dashboard.settings.error.noChannel' }),
  tts_unavailable: Object.freeze({ status: 409, text: 'dashboard.settings.error.ttsUnavailable' }),
});

const fail = (code) => ({ ok: false, code, status: ERRORS[code].status });
const isSnowflake = (value) => typeof value === 'string' && /^\d{17,20}$/.test(value);
const isNumberLike = (raw) => (typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== ''));

// The value a change carries, read as its setting's kind: { value } or { error }.
function readValue(setting, raw) {
  if (setting.kind === 'switch') {
    const value = parseSwitch(raw);
    return value === null ? { error: 'invalid' } : { value };
  }
  if (setting.kind === 'int' || setting.kind === 'number') {
    if (!isNumberLike(raw)) return { error: 'invalid' };
    const n = Number(raw);
    if (!Number.isFinite(n) || n < setting.min || n > setting.max) return { error: 'invalid' };
    if (setting.kind === 'int' && !Number.isInteger(n)) return { error: 'invalid' };
    return { value: n };
  }
  if (setting.kind === 'choice') {
    const n = isNumberLike(raw) ? Number(raw) : NaN;
    return setting.choices.includes(n) ? { value: n } : { error: 'invalid' };
  }
  if (typeof raw !== 'string') return { error: 'invalid' };
  const text = raw.trim();
  if (!text) return setting.allowEmpty ? { value: '' } : { error: 'required' };
  if (text.length > setting.max) return { error: 'too_long' };
  return { value: text };
}

// What `guildId` or `id` names, looked up with the streamer's id: { target } or { error }.
function findTarget(setting, change, streamer, db) {
  if (!setting.target) return { target: null };
  if (setting.target === 'sponsorMessage') {
    const id = Number(change.id);
    const message = Number.isInteger(id) && id > 0 ? db.getSponsorMessages(streamer.id).find((m) => m.id === id) : null;
    return message ? { target: message } : { error: 'not_found' };
  }
  const guild = isSnowflake(change.guildId) ? db.getGuildConfig(change.guildId, streamer.id) : null;
  if (!guild) return { error: 'not_found' };
  if (setting.target === 'guild') return { target: guild };
  return { target: { guild, watcher: db.getOwnWatcher(change.guildId, streamer.id, streamer.twitch_username) } };
}

// What is missing to switch a setting on (switching off never needs anything): an error code, or null.
function missingFirst(setting, value, streamer, target, { ttsAvailable }) {
  if (!value || !setting.needs) return null;
  if (setting.needs === 'ttsAvailable') return ttsAvailable ? null : 'tts_unavailable';
  if (setting.needs === 'paypalEmail') return streamer.paypal_email ? null : 'no_email';
  if (setting.needs === 'subRole') return target.sub_role_id ? null : 'no_role';
  const watcher = target.watcher;
  if (setting.needs === 'liveChannel') return watcher && watcher.live_channel_id ? null : 'no_channel';
  return watcher && watcher.clips_channel_id ? null : 'no_channel';
}

function write(db, streamerId, key, setting, value, target) {
  switch (setting.writer) {
    case 'chatbot': return db.updateChatbotConfig(streamerId, { [key]: value });
    case 'builtins': return db.updateBuiltinCommands(streamerId, { [key]: value });
    case 'moderation': return db.updateModerationConfig(streamerId, { [key]: value });
    case 'overlay': return db.updateOverlayConfig(streamerId, { [key]: value });
    case 'donations': return db.updateDonationSettings(streamerId, { [key]: value });
    case 'tts': return db.updateTtsSettings(streamerId, { [key]: value });
    case 'sponsorChat': return db.setSponsorChatSetting(streamerId, key, value);
    case 'guild': return db.setGuildSwitch(target.guild_id, streamerId, key, value);
    case 'watcher': return target.watcher ? db.setWatcherNotify(target.watcher.id, streamerId, key, value) : null;
    case 'sponsorMessage': return db.setSponsorMessageEnabled(target.id, streamerId, value);
    case 'polls': return db.updatePollSettings(streamerId, { [key]: value });
    case 'shoutouts': return db.updateShoutoutSettings(streamerId, { [key]: value });
    default: throw new Error(`no writer for ${key}`);
  }
}

// `body` is one change ({ key, value, guildId?, id? }) or { changes: [...] } (at most BATCH_MAX). Every
// change is read and checked before any is written; then all are written in one transaction, and the
// follow-ups run once with the streamer's row before and after and the steps the keys name. `ttsAvailable`: whether
// reading tips aloud can be switched on (the site has an ElevenLabs key).
function save(streamer, body, { db, followUps, ttsAvailable = false }) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  const list = input && Array.isArray(input.changes) ? input.changes : (input && 'key' in input ? [input] : null);
  if (!list || list.length === 0 || list.length > BATCH_MAX) return fail('invalid');

  const plan = [];
  for (const change of list) {
    if (!change || typeof change !== 'object' || typeof change.key !== 'string'
      || !Object.prototype.hasOwnProperty.call(SETTINGS, change.key)) return fail('invalid');
    const setting = SETTINGS[change.key];
    const read = readValue(setting, change.value);
    if (read.error) return fail(read.error);
    const found = findTarget(setting, change, streamer, db);
    if (found.error) return fail(found.error);
    const missing = missingFirst(setting, read.value, streamer, found.target, { ttsAvailable });
    if (missing) return fail(missing);
    plan.push({ key: change.key, setting, value: read.value, target: found.target });
  }

  db.runInTransaction(() => {
    for (const p of plan) write(db, streamer.id, p.key, p.setting, p.value, p.target);
  });
  const steps = new Set(plan.flatMap((p) => p.setting.after || []));
  followUps.run({ before: streamer, after: db.getStreamerById(streamer.id), steps });
  return { ok: true, values: Object.fromEntries(plan.map((p) => [p.key, p.value])) };
}

module.exports = { SETTINGS, ERRORS, BATCH_MAX, TEMPLATE_MAX, save };
