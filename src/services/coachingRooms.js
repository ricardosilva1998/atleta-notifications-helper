'use strict';

// The private Discord room of a confirmed coaching session (planning decisions 10, 12, 13): a role and a voice channel
// (its built-in text chat carries the messages and files) in the streamer's Coaching category, made when a booking
// is confirmed, closed 30 minutes after the session ends with a transcript DMed to both sides, then deleted.
//
// Every Discord id is written to the coaching_rooms row as it is made, so a restart can finish or clean up a half-made
// pair. A failure never undoes the booking: the row is `failed` with an error code, shown on the schedule with Retry.
// Nothing here throws; Discord down or DISCORD_DISABLED=1 just leaves rooms failed (or waiting to close).

const db = require('../db');
const discord = require('../discord');
const { t } = require('../i18n');
const coaching = require('./coaching');

const MINUTE_MS = 60e3;
const CLOSE_DELAY_MS = 30 * MINUTE_MS; // the room stays this long after the session ends
const MAKING_STALE_MS = 2 * MINUTE_MS; // a `making` row older than this is from a run that is gone
const NAME_MAX = 100;
const FILE_MAX_BYTES = 10 * 1024 * 1024; // one attachment re-uploaded at most this big
const BATCH_MAX_BYTES = 10 * 1024 * 1024; // and one message carries at most this much
const BATCH_MAX_FILES = 10;
const CLOSE_GIVE_UP_MS = 6 * 3600e3; // a transcript that cannot even be read for this long after close_at is dropped

const VIEW = ['ViewChannel', 'Connect', 'Speak', 'SendMessages', 'AttachFiles', 'ReadMessageHistory'];
const ROLE = 0;
const MEMBER = 1;

const running = new Set(); // booking ids being built or closed in this process

// The room's permission overwrites (decision 10): @everyone (the guild's id) cannot see or join; the session role, the
// coach and the bot can use it, the bot also manages it. Nothing outside the category is touched.
function roomOverwrites({ guildId, roleId, coachId, botId }) {
  const out = [
    { id: String(guildId), type: ROLE, allow: [], deny: ['ViewChannel', 'Connect'] },
    { id: roleId, type: ROLE, allow: [...VIEW], deny: [] },
  ];
  if (coachId) out.push({ id: coachId, type: MEMBER, allow: [...VIEW], deny: [] });
  if (botId) out.push({ id: botId, type: MEMBER, allow: [...VIEW, 'ManageChannels'], deny: [] });
  return out;
}

// `coaching-<username>-<YYYY-MM-DD>`: the Discord username lowercased to [a-z0-9_.-], the date in the streamer's zone.
function roomName(viewerUsername, startsAt, timeZone) {
  const user = String(viewerUsername || '').toLowerCase().replace(/[^a-z0-9_.-]/g, '') || 'viewer';
  return `coaching-${user}-${coaching.localDateOf(startsAt, timeZone)}`.slice(0, NAME_MAX);
}

const roomUrlOf = (room) => `https://discord.com/channels/${room.guild_id}/${room.channel_id}`;
const sessionEnd = (booking) => booking.starts_at + booking.minutes * MINUTE_MS;

function errorCode(e, step) {
  const code = e && e.code;
  if (e && (e.message === 'not_ready' || e.message === 'deadline')) return 'discord_down';
  if (code === 50013 || code === 50001) return 'missing_permissions';
  if (step === 'role_member' && code === 10007) return 'viewer_not_member';
  return 'failed';
}

// One resumable pass: each step runs only if its id is not stored yet.
async function build(bookingId, now) {
  const booking = db.getCoachingBookingById(bookingId);
  const streamer = booking ? db.getStreamerById(booking.streamer_id) : null;
  const settings = streamer ? db.getCoachingSettings(streamer.id) : null;
  let room = db.getCoachingRoom(bookingId);
  if (!booking || !streamer || !settings || !room) return null;
  let step = 'role';
  try {
    if (!discord.isReady()) throw new Error('not_ready');
    if (!room.role_id) {
      const roleId = await discord.createRole(room.guild_id, roomName(booking.viewer_username, booking.starts_at, settings.time_zone));
      room = db.updateCoachingRoom(bookingId, { role_id: roleId }, now);
    }
    step = 'role_member';
    await discord.addRoleToMember(room.guild_id, booking.viewer_discord_id, room.role_id);
    step = 'channel';
    if (!room.channel_id) {
      const overwrites = roomOverwrites({
        guildId: room.guild_id, roleId: room.role_id, coachId: streamer.discord_user_id,
        botId: discord.client.user && discord.client.user.id,
      });
      const name = roomName(booking.viewer_username, booking.starts_at, settings.time_zone);
      let channelId;
      try {
        channelId = await discord.createVoiceChannel(room.guild_id, { name, parentId: room.category_id, overwrites });
      } catch (e) {
        // The coach may not be in the server (Discord refuses a member overwrite for a non-member): without theirs.
        if (!(e && (e.code === 10007 || e.code === 50035)) || !streamer.discord_user_id) throw e;
        channelId = await discord.createVoiceChannel(room.guild_id, {
          name, parentId: room.category_id, overwrites: overwrites.filter((o) => o.id !== streamer.discord_user_id),
        });
      }
      room = db.updateCoachingRoom(bookingId, { channel_id: channelId }, now);
    }
    room = db.updateCoachingRoom(bookingId, { state: 'open', error: null }, now);
    return { url: roomUrlOf(room) };
  } catch (e) {
    const code = errorCode(e, step);
    console.error(`[Coaching] room of booking ${bookingId} failed at ${step}: ${(e && e.message) || e} (${code})`);
    try { db.updateCoachingRoom(bookingId, { state: 'failed', error: code }, now); } catch (e2) { /* the row is gone */ }
    return null;
  }
}

// Called when a booking becomes confirmed (paid, or a free length accepted). Makes the row and the room when the
// streamer set a Coaching category. Never throws; resolves { url } or null.
async function makeFor(bookingId, { now = Date.now() } = {}) {
  try {
    if (running.has(bookingId)) return null;
    const booking = db.getCoachingBookingById(bookingId);
    if (!booking || booking.status !== 'confirmed' || booking.price_cents == null) return null;
    const settings = db.getCoachingSettings(booking.streamer_id);
    if (!settings || !settings.category_id || !settings.guild_id) return null;
    let room = db.getCoachingRoom(bookingId);
    if (room && room.state === 'open') return { url: roomUrlOf(room) };
    if (room) return null;
    room = db.createCoachingRoom({
      bookingId, streamerId: booking.streamer_id, guildId: settings.guild_id, categoryId: settings.category_id,
      closeAt: sessionEnd(booking) + CLOSE_DELAY_MS, now,
    });
    running.add(bookingId);
    try { return await build(bookingId, now); } finally { running.delete(bookingId); }
  } catch (e) {
    console.error(`[Coaching] room for booking ${bookingId}:`, e && e.message);
    return null;
  }
}

// Deletes whatever a room holds on Discord; resolves true when nothing is left there (or never was).
async function clean(room) {
  let ok = true;
  try { await discord.deleteChannel(room.guild_id, room.channel_id); } catch (e) { ok = false; }
  try { await discord.deleteRole(room.guild_id, room.role_id); } catch (e) { ok = false; }
  return ok;
}

// Retry room (the schedule's button): a failed room has its half-made role and channel deleted first, then is made
// again. A confirmed booking without a room (no category was set then) gets one if a category is set now.
// Resolves { ok: true, room } or { ok: false, code }.
async function retry(streamer, bookingId, { now = Date.now() } = {}) {
  try {
    const booking = db.getCoachingBooking(bookingId, streamer.id);
    if (!booking) return { ok: false, code: 'not_found' };
    if (booking.status !== 'confirmed' || booking.price_cents == null) return { ok: false, code: 'not_active' };
    if (sessionEnd(booking) <= now) return { ok: false, code: 'too_late' };
    const settings = db.getCoachingSettings(streamer.id);
    if (!settings || !settings.category_id || !settings.guild_id) return { ok: false, code: 'no_category' };
    if (running.has(bookingId)) return { ok: false, code: 'room_busy' };
    let room = db.getCoachingRoom(bookingId);
    if (room && room.state !== 'failed') return { ok: false, code: 'room_not_failed' };
    running.add(bookingId);
    try {
      if (room) {
        if (!(await clean(room))) {
          db.updateCoachingRoom(bookingId, { error: 'discord_down' }, now);
          return { ok: false, code: 'discord_down', room: db.getCoachingRoom(bookingId) };
        }
        room = db.updateCoachingRoom(bookingId, {
          role_id: null, channel_id: null, state: 'making', error: null, guild_id: settings.guild_id,
          category_id: settings.category_id, close_at: sessionEnd(booking) + CLOSE_DELAY_MS,
        }, now);
      } else {
        db.createCoachingRoom({
          bookingId, streamerId: streamer.id, guildId: settings.guild_id, categoryId: settings.category_id,
          closeAt: sessionEnd(booking) + CLOSE_DELAY_MS, now,
        });
      }
      await build(bookingId, now);
    } finally { running.delete(bookingId); }
    return { ok: true, room: db.getCoachingRoom(bookingId) };
  } catch (e) {
    console.error(`[Coaching] retry of room ${bookingId}:`, e && e.message);
    return { ok: false, code: 'failed' };
  }
}

// `making` rows left by a run that is gone (a restart): finished from the ids already stored, or cleaned up when the
// booking is no longer a confirmed session to come.
async function finishOrCleanMaking({ now = Date.now() } = {}) {
  let finished = 0;
  let cleaned = 0;
  for (const room of db.listMakingCoachingRooms(now - MAKING_STALE_MS)) {
    if (running.has(room.booking_id)) continue;
    running.add(room.booking_id);
    try {
      const booking = db.getCoachingBookingById(room.booking_id);
      if (booking && booking.status === 'confirmed' && sessionEnd(booking) > now) {
        const made = await build(room.booking_id, now);
        if (made) finished++;
      } else if (discord.isReady()) {
        if (await clean(room)) {
          db.updateCoachingRoom(room.booking_id, { state: 'closed', error: null }, now);
          cleaned++;
        }
      }
    } catch (e) {
      console.error(`[Coaching] finishing room ${room.booking_id}:`, e && e.message);
    } finally { running.delete(room.booking_id); }
  }
  return { finished, cleaned };
}

// ── Transcript ──────────────────────────────────────────────────────────────

function zoned(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).reduce((o, p) => { o[p.type] = p.value; return o; }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

// Which attachments are re-uploaded and in which messages: each at most FILE_MAX_BYTES (bigger ones are named as too
// big), a message at most BATCH_MAX_FILES files and BATCH_MAX_BYTES. Pure. `files`: [{ key, size }]; resolves
// { batches: [[key, ...]], tooBig: [key, ...] }.
function planAttachments(files, { fileMax = FILE_MAX_BYTES, batchBytes = BATCH_MAX_BYTES, batchFiles = BATCH_MAX_FILES } = {}) {
  const batches = [];
  const tooBig = [];
  let current = [];
  let bytes = 0;
  for (const f of files) {
    if (!(f.size <= fileMax)) { tooBig.push(f.key); continue; }
    if (current.length && (current.length >= batchFiles || bytes + f.size > batchBytes)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(f.key);
    bytes += f.size;
  }
  if (current.length) batches.push(current);
  return { batches, tooBig };
}

// The transcript text (pure). `messages` are oldest first; `statusOf(attachment)` is 'attached', 'too_big' or
// 'not_fetched'. Header: coach, viewer, the session and its zone; then `YYYY-MM-DD HH:MM name: text` lines in that
// zone. The bot's own messages are left out. A room with no messages says so in one line.
function buildTranscript({ coachName, viewerName, startsAt, minutes, timeZone, messages, statusOf = () => 'attached', t: tr }) {
  const lines = [
    tr('coaching.transcript.title'),
    tr('coaching.transcript.coach', { name: coachName }),
    tr('coaching.transcript.viewer', { name: viewerName }),
    tr('coaching.transcript.session', { start: zoned(startsAt, timeZone), end: zoned(startsAt + minutes * MINUTE_MS, timeZone), zone: timeZone }),
    '',
  ];
  const own = (messages || []).filter((m) => !m.bot && (m.content || (m.attachments && m.attachments.length)));
  if (!own.length) {
    lines.push(tr('coaching.transcript.empty'));
  } else {
    for (const m of own) {
      const text = String(m.content || '').replace(/\r?\n/g, '\n    ');
      lines.push(`${zoned(m.at, timeZone)} ${m.author}:${text ? ` ${text}` : ''}`);
      for (const a of m.attachments || []) {
        const status = statusOf(a);
        const text = status === 'attached' ? tr('coaching.transcript.attached', { name: a.name })
          : status === 'too_big' ? tr('coaching.transcript.tooBig', { name: a.name })
            : tr('coaching.transcript.notFetched', { name: a.name });
        lines.push(`    ${text}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

// Reads the chat, downloads what can be re-uploaded and sends the transcript to the viewer and the coach, once each.
// Resolves the transcript status: 'sent', 'partial', 'failed', 'no_intent', 'no_channel'. Throws only when Discord
// could not be read (the caller keeps the room and tries again later).
async function sendTranscripts(room, booking, streamer, settings, { fetchMessages = (...a) => discord.fetchAllMessages(...a), download = (...a) => discord.downloadAttachment(...a) } = {}) {
  if (!discord.hasMessageContent()) return 'no_intent';
  const messages = room.channel_id ? await fetchMessages(room.guild_id, room.channel_id) : null;
  if (messages === null) return 'no_channel';
  const flat = [];
  messages.forEach((m, i) => (m.attachments || []).forEach((a, j) => { a.key = `${i}:${j}`; flat.push(a); }));
  const plan = planAttachments(flat.map((a) => ({ key: a.key, size: a.size })));
  const bytes = new Map();
  const failed = new Set();
  for (const batch of plan.batches) {
    for (const key of batch) {
      const a = flat.find((x) => x.key === key);
      try { bytes.set(key, await download(a.url, { maxBytes: FILE_MAX_BYTES })); } catch (e) {
        failed.add(key);
        console.error(`[Coaching] attachment of room ${room.booking_id} not fetched: ${e && e.message}`);
      }
    }
  }
  const lang = settings.lang || 'en';
  const tr = (key, params) => t(lang, key, params);
  const text = buildTranscript({
    coachName: streamer.twitch_display_name || streamer.twitch_username || '',
    viewerName: booking.viewer_display_name || booking.viewer_username,
    startsAt: booking.starts_at, minutes: booking.minutes, timeZone: settings.time_zone, messages,
    statusOf: (a) => (plan.tooBig.includes(a.key) ? 'too_big' : failed.has(a.key) ? 'not_fetched' : 'attached'),
    t: tr,
  });
  const sendable = plan.batches.map((batch) => batch.filter((k) => bytes.has(k)).map((k) => {
    const a = flat.find((x) => x.key === k);
    return { attachment: Buffer.from(bytes.get(k)), name: a.name };
  })).filter((b) => b.length);

  const sides = [
    { id: booking.viewer_discord_id, lang: booking.lang || 'en', other: streamer.twitch_display_name || streamer.twitch_username || '' },
    { id: streamer.discord_user_id, lang, other: booking.viewer_display_name || booking.viewer_username },
  ].filter((s, i, all) => s.id && all.findIndex((x) => x.id === s.id) === i);
  let ok = 0;
  for (const side of sides) {
    const content = t(side.lang, 'coaching.message.transcript.body', { other: discord.escapeLinkText(side.other) });
    const first = await discord.sendDirectMessage(side.id, {
      content, files: [{ attachment: Buffer.from(text, 'utf8'), name: 'transcript.txt' }],
    }, { deadlineMs: 30000 });
    if (!first.ok) continue;
    ok++;
    for (const files of sendable) {
      const more = await discord.sendDirectMessage(side.id, { files }, { deadlineMs: 30000 });
      if (!more.ok) break;
    }
  }
  if (ok === sides.length) return 'sent';
  return ok ? 'partial' : 'failed';
}

// Rooms past close_at (30 minutes after the session): transcript once, then the channel and the role are deleted. While
// Discord is not ready nothing happens. A deletion that fails leaves the room `closing` for the next pass (the
// transcript status is already recorded, so nothing is sent twice).
async function closeDue({ now = Date.now(), deps = {} } = {}) {
  let closed = 0;
  if (!discord.isReady()) return { closed };
  for (const room of db.listDueCoachingRooms(now)) {
    if (running.has(room.booking_id)) continue;
    running.add(room.booking_id);
    try {
      let current = db.updateCoachingRoom(room.booking_id, { state: 'closing' }, now);
      const booking = db.getCoachingBookingById(room.booking_id);
      const streamer = booking ? db.getStreamerById(booking.streamer_id) : null;
      const settings = streamer ? db.getCoachingSettings(streamer.id) : null;
      if (current.transcript_status == null) {
        let status;
        if (!booking || !streamer || !settings) status = 'failed';
        else {
          try { status = await sendTranscripts(current, booking, streamer, settings, deps); } catch (e) {
            if (now - room.close_at < CLOSE_GIVE_UP_MS) continue; // Discord could not be read: next pass
            status = 'failed';
          }
        }
        current = db.updateCoachingRoom(room.booking_id, { transcript_status: status }, now);
      }
      if (await clean(current)) {
        db.updateCoachingRoom(room.booking_id, { state: 'closed' }, now);
        closed++;
      }
    } catch (e) {
      console.error(`[Coaching] closing room ${room.booking_id}:`, e && e.message);
    } finally { running.delete(room.booking_id); }
  }
  return { closed };
}

// Before a streamer's rows are deleted (admin Remove): the rooms they hold are deleted on Discord, best effort. The
// rows are read at once, so the caller may delete them right after; resolves when Discord has been asked. Never throws.
function removeAllFor(streamerId) {
  let rooms = [];
  try { rooms = db.listCoachingRoomsToRemove(streamerId); } catch (e) { return Promise.resolve(); }
  return (async () => {
    if (!discord.isReady()) return;
    for (const room of rooms) {
      try { await clean(room); } catch (e) { /* best effort */ }
    }
  })();
}

module.exports = {
  makeFor, retry, finishOrCleanMaking, closeDue, removeAllFor, sendTranscripts,
  roomOverwrites, roomName, roomUrlOf, planAttachments, buildTranscript, errorCode,
  CLOSE_DELAY_MS, MAKING_STALE_MS, FILE_MAX_BYTES,
};
