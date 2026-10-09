# Multistream Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any registered streamer broadcast to **Twitch + Kick simultaneously** by pushing one RTMP stream from OBS to a relay we control. Zero CPU/upload impact on the streamer beyond a normal single-platform broadcast.

**Architecture:** Streamer's OBS pushes one RTMP stream to `rtmp://ingest.atletanotifications.com/live/<token>` (a MediaMTX server we host on Oracle Cloud Always Free — 10 TB/mo egress free, forever). When the stream becomes ready, MediaMTX hits a webhook on the existing Express app on Railway. The webhook looks up the streamer's stored Twitch + Kick stream keys, then tells MediaMTX (via its HTTP control API) to spawn one `ffmpeg -c copy` forwarder per destination. No re-encoding anywhere — bytes flow streamer → relay → platforms with only a remux. App on Railway stays the source of truth for config + auth; only video bytes touch the relay.

**Tech Stack:** Existing — Express 5, EJS, better-sqlite3, plain CommonJS. New on the relay box only — MediaMTX (single Go binary), ffmpeg (system package). New env vars on the Railway side. No new npm dependencies on the app side except `node:crypto` (built-in) for AES-GCM encryption of stream keys.

**Out of scope for this plan (follow-ups):**
- YouTube as a third destination (requires per-stream Live Broadcast creation via YouTube Data API — separate plan)
- Live viewer count / per-platform health overlay on dashboard (cosmetic; ship MVP first)
- Automatic egress cap enforcement that disconnects streamers (we ship a manual ops dashboard first; auto-cut comes after we see real usage)
- Multi-region relay (one Oracle Free Tier VM in São Paulo region — sufficient for current scale)

---

## File Structure

**Files to create:**
- `src/services/multistreamRelay.js` — HTTP client for MediaMTX control API; functions to add/remove forwarder paths and read stats
- `src/services/streamKeyCrypto.js` — AES-256-GCM helpers for encrypting/decrypting per-streamer Twitch + Kick stream keys at rest
- `src/routes/multistream.js` — Express routes for the dashboard page, form submit, enable/disable toggle, MediaMTX webhooks
- `src/views/multistream.ejs` — Dashboard UI for managing keys + ingest URL
- `tests/multistream.spec.js` — Playwright E2E for the dashboard page (loads, saves, displays ingest URL)
- `tests/streamKeyCrypto.test.js` — `node:test` unit tests for encrypt/decrypt round-trip
- `tests/multistreamRelay.test.js` — `node:test` unit tests for the MediaMTX client (mocked HTTP)
- `docs/multistream-relay-setup.md` — operator-side setup guide for the Oracle Free Tier VM + MediaMTX install

**Files to modify:**
- `src/db.js` — Add migration for `streamers` columns (`multistream_*`); add query helpers
- `src/config.js` — Add `MEDIAMTX_API_URL`, `MEDIAMTX_INGEST_URL`, `MEDIAMTX_API_TOKEN`, `MEDIAMTX_WEBHOOK_SECRET`, `MULTISTREAM_KEY_SECRET` env vars
- `src/server.js` — Mount `/dashboard/multistream` and `/api/multistream/webhook/*` routes
- `src/views/dashboard.ejs` — Add a "Multistream" card on the Twitch tab linking to the new page
- `CLAUDE.md` — Document the new service, routes, env vars, and architecture in the relevant sections

---

## Task 1: Database schema + encryption helper

**Files:**
- Modify: `src/db.js` (migration block + new query helpers, near the existing streamer column ALTERs around lines 143-181)
- Create: `src/services/streamKeyCrypto.js`
- Create: `tests/streamKeyCrypto.test.js`

- [ ] **Step 1: Write the failing crypto round-trip test**

Create `tests/streamKeyCrypto.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { encryptKey, decryptKey } = require('../src/services/streamKeyCrypto');

const SECRET = 'a'.repeat(64); // 32-byte hex

test('encrypt/decrypt round-trips', () => {
  const plaintext = 'live_123456_abcdefGHIJKLmnopqr';
  const ciphertext = encryptKey(plaintext, SECRET);
  assert.notStrictEqual(ciphertext, plaintext);
  assert.match(ciphertext, /^v1:[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/);
  const recovered = decryptKey(ciphertext, SECRET);
  assert.strictEqual(recovered, plaintext);
});

test('decrypt rejects tampered ciphertext', () => {
  const ciphertext = encryptKey('hello', SECRET);
  const tampered = ciphertext.slice(0, -2) + (ciphertext.slice(-2) === 'aa' ? 'bb' : 'aa');
  assert.throws(() => decryptKey(tampered, SECRET));
});

test('decrypt rejects wrong secret', () => {
  const ciphertext = encryptKey('hello', 'a'.repeat(64));
  assert.throws(() => decryptKey(ciphertext, 'b'.repeat(64)));
});

test('encryptKey returns null for null/empty input', () => {
  assert.strictEqual(encryptKey(null, SECRET), null);
  assert.strictEqual(encryptKey('', SECRET), null);
});

test('decryptKey returns null for null/empty input', () => {
  assert.strictEqual(decryptKey(null, SECRET), null);
  assert.strictEqual(decryptKey('', SECRET), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/streamKeyCrypto.test.js`
Expected: FAIL — "Cannot find module '../src/services/streamKeyCrypto'"

- [ ] **Step 3: Implement `src/services/streamKeyCrypto.js`**

Create `src/services/streamKeyCrypto.js`:

```js
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

function getKey(secretHex) {
  if (!secretHex || secretHex.length !== 64) {
    throw new Error('MULTISTREAM_KEY_SECRET must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(secretHex, 'hex');
}

function encryptKey(plaintext, secretHex) {
  if (plaintext == null || plaintext === '') return null;
  const key = getKey(secretHex);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptKey(ciphertext, secretHex) {
  if (ciphertext == null || ciphertext === '') return null;
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('invalid ciphertext format');
  }
  const [, ivHex, tagHex, encHex] = parts;
  const key = getKey(secretHex);
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(enc), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encryptKey, decryptKey };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/streamKeyCrypto.test.js`
Expected: PASS — 5 tests pass

- [ ] **Step 5: Add the migration block + query helpers to `src/db.js`**

Find the block ending around line 181 (the chat-template ALTERs) and append a new migration block right after, following the existing pattern of try/catch around each ALTER (mirror lines 143-181):

```js
    // Multistream relay (Twitch + Kick passthrough via MediaMTX)
    try { db.exec('ALTER TABLE streamers ADD COLUMN multistream_enabled INTEGER DEFAULT 0'); } catch (e) {}
    try { db.exec('ALTER TABLE streamers ADD COLUMN multistream_token TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE streamers ADD COLUMN multistream_twitch_key_enc TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE streamers ADD COLUMN multistream_kick_key_enc TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE streamers ADD COLUMN multistream_last_started_at INTEGER'); } catch (e) {}
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_streamers_multistream_token ON streamers(multistream_token) WHERE multistream_token IS NOT NULL');
```

(Match the project's actual try/catch style — if the existing code wraps the entire migration block in one try/catch instead of per-ALTER, follow that.)

Then add these query helpers near the bottom of `src/db.js`. Search for `getStreamerById` to find the right area and keep the new functions next to other streamer queries:

```js
function getMultistreamConfig(streamerId) {
  return db.prepare(`
    SELECT
      id,
      multistream_enabled,
      multistream_token,
      multistream_twitch_key_enc,
      multistream_kick_key_enc,
      multistream_last_started_at
    FROM streamers WHERE id = ?
  `).get(streamerId);
}

function setMultistreamConfig(streamerId, { enabled, twitchKeyEnc, kickKeyEnc }) {
  return db.prepare(`
    UPDATE streamers
    SET multistream_enabled = ?,
        multistream_twitch_key_enc = ?,
        multistream_kick_key_enc = ?
    WHERE id = ?
  `).run(enabled ? 1 : 0, twitchKeyEnc, kickKeyEnc, streamerId);
}

function ensureMultistreamToken(streamerId) {
  const row = db.prepare('SELECT multistream_token FROM streamers WHERE id = ?').get(streamerId);
  if (row && row.multistream_token) return row.multistream_token;
  const token = require('crypto').randomBytes(24).toString('base64url');
  db.prepare('UPDATE streamers SET multistream_token = ? WHERE id = ?').run(token, streamerId);
  return token;
}

function getStreamerByMultistreamToken(token) {
  return db.prepare(`
    SELECT id, multistream_enabled, multistream_twitch_key_enc, multistream_kick_key_enc
    FROM streamers WHERE multistream_token = ?
  `).get(token);
}

function markMultistreamStarted(streamerId) {
  return db.prepare('UPDATE streamers SET multistream_last_started_at = ? WHERE id = ?')
    .run(Date.now(), streamerId);
}
```

Add the new function names to the `module.exports` block at the bottom of the file in the same style the file already uses for exports.

- [ ] **Step 6: Boot the app to verify the migration applies cleanly**

Run: `npm run dev`
Expected: server starts without DB errors. On a DB that's never had this migration before, the ALTERs succeed silently. On an existing DB with these columns already present, the per-ALTER try/catch swallows "duplicate column name" errors as designed.

Stop the server with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add src/db.js src/services/streamKeyCrypto.js tests/streamKeyCrypto.test.js
git commit -m "feat(multistream): db schema + AES-GCM stream-key encryption"
```

---

## Task 2: Config and env var wiring

**Files:**
- Modify: `src/config.js`

- [ ] **Step 1: Add the multistream config block to `src/config.js`**

Find the `module.exports = { ... }` block and add a `multistream` sub-object:

```js
  multistream: {
    apiUrl: process.env.MEDIAMTX_API_URL || '',           // e.g. https://relay.atletanotifications.com
    ingestUrl: process.env.MEDIAMTX_INGEST_URL || '',     // e.g. rtmp://ingest.atletanotifications.com/live
    apiToken: process.env.MEDIAMTX_API_TOKEN || '',       // bearer token for MediaMTX /v3/* endpoints
    webhookSecret: process.env.MEDIAMTX_WEBHOOK_SECRET || '', // shared secret in MediaMTX runOnReady webhook
    keySecret: process.env.MULTISTREAM_KEY_SECRET || '',  // 64-char hex (32 bytes) for AES-GCM at rest
    enabled: !!(process.env.MEDIAMTX_API_URL && process.env.MULTISTREAM_KEY_SECRET),
  },
```

- [ ] **Step 2: Verify config loads**

Run: `node -e "console.log(require('./src/config').multistream)"`
Expected: prints the object with empty strings (since env vars unset). `enabled: false`.

Then with vars set:
```bash
MEDIAMTX_API_URL=https://example.com MULTISTREAM_KEY_SECRET=$(openssl rand -hex 32) node -e "console.log(require('./src/config').multistream)"
```
Expected: `enabled: true`, `keySecret` is a 64-char hex.

- [ ] **Step 3: Commit**

```bash
git add src/config.js
git commit -m "feat(multistream): config + env var wiring"
```

---

## Task 3: MediaMTX HTTP client

**Files:**
- Create: `src/services/multistreamRelay.js`
- Create: `tests/multistreamRelay.test.js`

- [ ] **Step 1: Write failing tests for the MediaMTX client**

Create `tests/multistreamRelay.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');

function withMockedFetch(fn) {
  return async (t) => {
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    };
    delete require.cache[require.resolve('../src/services/multistreamRelay')];
    const relay = require('../src/services/multistreamRelay');
    try {
      await fn(t, relay, calls);
    } finally {
      delete global.fetch;
    }
  };
}

test('addForwardPaths posts one config per destination', withMockedFetch(async (t, relay, calls) => {
  await relay.addForwardPaths({
    apiUrl: 'http://relay.example:9997',
    apiToken: 'tok',
    sourceToken: 'src_abc',
    destinations: [
      { name: 'twitch', url: 'rtmp://live.twitch.tv/app/live_xxx' },
      { name: 'kick', url: 'rtmp://fa723fc1b171.global-contribute.live-video.net/app/sk_xxx' },
    ],
  });
  assert.strictEqual(calls.length, 2);
  assert.match(calls[0].url, /\/v3\/config\/paths\/add\/fwd_src_abc_twitch$/);
  assert.match(calls[1].url, /\/v3\/config\/paths\/add\/fwd_src_abc_kick$/);
  for (const c of calls) {
    assert.strictEqual(c.opts.method, 'POST');
    assert.strictEqual(c.opts.headers['Authorization'], 'Bearer tok');
    const body = JSON.parse(c.opts.body);
    assert.strictEqual(body.source, 'rtmp://localhost/live/src_abc');
    assert.match(body.runOnReady, /^ffmpeg.*-c copy.*-f flv.*rtmp:/);
  }
}));

test('removeForwardPaths deletes both forwarders', withMockedFetch(async (t, relay, calls) => {
  await relay.removeForwardPaths({
    apiUrl: 'http://relay.example:9997',
    apiToken: 'tok',
    sourceToken: 'src_abc',
    destinationNames: ['twitch', 'kick'],
  });
  assert.strictEqual(calls.length, 2);
  for (const c of calls) {
    assert.strictEqual(c.opts.method, 'DELETE');
    assert.match(c.url, /\/v3\/config\/paths\/delete\/fwd_src_abc_(twitch|kick)$/);
  }
}));

test('addForwardPaths skips empty destinations', withMockedFetch(async (t, relay, calls) => {
  await relay.addForwardPaths({
    apiUrl: 'http://relay.example:9997',
    apiToken: 'tok',
    sourceToken: 'src_abc',
    destinations: [
      { name: 'twitch', url: 'rtmp://live.twitch.tv/app/live_xxx' },
      { name: 'kick', url: '' },
    ],
  });
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].url, /twitch$/);
}));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/multistreamRelay.test.js`
Expected: FAIL — "Cannot find module '../src/services/multistreamRelay'"

- [ ] **Step 3: Implement `src/services/multistreamRelay.js`**

```js
function buildFfmpegCmd(localSource, destUrl) {
  // -c copy = no re-encode (passthrough remux)
  // -f flv  = RTMP container format
  // -reconnect 1 = auto-reconnect on transient socket failures
  return `ffmpeg -nostdin -loglevel warning -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -i ${localSource} -c copy -f flv ${destUrl}`;
}

async function addForwardPaths({ apiUrl, apiToken, sourceToken, destinations }) {
  const localSource = `rtmp://localhost/live/${sourceToken}`;
  for (const dest of destinations) {
    if (!dest.url) continue;
    const pathName = `fwd_${sourceToken}_${dest.name}`;
    const url = `${apiUrl.replace(/\/$/, '')}/v3/config/paths/add/${pathName}`;
    const body = {
      source: localSource,
      sourceOnDemand: false,
      runOnReady: buildFfmpegCmd(localSource, dest.url),
      runOnReadyRestart: true,
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MediaMTX add ${pathName} failed: ${res.status} ${text}`);
    }
  }
}

async function removeForwardPaths({ apiUrl, apiToken, sourceToken, destinationNames }) {
  for (const name of destinationNames) {
    const pathName = `fwd_${sourceToken}_${name}`;
    const url = `${apiUrl.replace(/\/$/, '')}/v3/config/paths/delete/${pathName}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${apiToken}` },
    });
    // 404 = already gone, treat as success
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`MediaMTX delete ${pathName} failed: ${res.status} ${text}`);
    }
  }
}

async function getPathStats({ apiUrl, apiToken, sourceToken }) {
  const url = `${apiUrl.replace(/\/$/, '')}/v3/paths/get/live/${sourceToken}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`MediaMTX stats ${sourceToken} failed: ${res.status}`);
  return res.json();
}

module.exports = { addForwardPaths, removeForwardPaths, getPathStats };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/multistreamRelay.test.js`
Expected: PASS — 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/services/multistreamRelay.js tests/multistreamRelay.test.js
git commit -m "feat(multistream): MediaMTX HTTP client for forwarder paths"
```

---

## Task 4: Routes — page, save, MediaMTX webhooks

**Files:**
- Create: `src/routes/multistream.js`
- Modify: `src/server.js` (mount the router)

- [ ] **Step 1: Implement `src/routes/multistream.js`**

```js
const express = require('express');
const router = express.Router();
const config = require('../config');
const db = require('../db');
const { encryptKey, decryptKey } = require('../services/streamKeyCrypto');
const relay = require('../services/multistreamRelay');

const TWITCH_INGEST = 'rtmp://live.twitch.tv/app';
const KICK_INGEST = 'rtmp://fa723fc1b171.global-contribute.live-video.net/app';

function requireStreamer(req, res, next) {
  if (!req.streamer) return res.redirect('/streamer');
  next();
}

router.get('/', requireStreamer, (req, res) => {
  const cfg = db.getMultistreamConfig(req.streamer.id) || {};
  const token = db.ensureMultistreamToken(req.streamer.id);
  res.render('multistream', {
    streamer: req.streamer,
    multistream: cfg,
    ingestUrl: config.multistream.ingestUrl || 'rtmp://ingest.atletanotifications.com/live',
    streamKey: token,
    relayConfigured: config.multistream.enabled,
    hasTwitchKey: !!cfg.multistream_twitch_key_enc,
    hasKickKey: !!cfg.multistream_kick_key_enc,
    query: req.query,
  });
});

router.post('/save', requireStreamer, express.urlencoded({ extended: false }), (req, res) => {
  const { twitch_key, kick_key, enabled } = req.body;
  const cur = db.getMultistreamConfig(req.streamer.id) || {};

  // Empty input = keep existing key. To clear, send "__clear__".
  let twitchEnc = cur.multistream_twitch_key_enc;
  if (twitch_key === '__clear__') twitchEnc = null;
  else if (twitch_key && twitch_key.trim()) {
    twitchEnc = encryptKey(twitch_key.trim(), config.multistream.keySecret);
  }

  let kickEnc = cur.multistream_kick_key_enc;
  if (kick_key === '__clear__') kickEnc = null;
  else if (kick_key && kick_key.trim()) {
    kickEnc = encryptKey(kick_key.trim(), config.multistream.keySecret);
  }

  db.setMultistreamConfig(req.streamer.id, {
    enabled: !!enabled,
    twitchKeyEnc: twitchEnc,
    kickKeyEnc: kickEnc,
  });
  res.redirect('/dashboard/multistream?saved=1');
});

// MediaMTX hits this when a streamer connects to the ingest URL.
// MediaMTX runOnReady POST body: { path: "live/<token>", source: { ... } }
router.post('/webhook/on-ready', express.json(), async (req, res) => {
  const auth = req.get('Authorization') || '';
  if (auth !== `Bearer ${config.multistream.webhookSecret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const path = (req.body && req.body.path) || '';
  const token = path.replace(/^live\//, '');
  if (!token) return res.status(400).json({ error: 'missing path' });

  const streamer = db.getStreamerByMultistreamToken(token);
  if (!streamer) return res.status(404).json({ error: 'unknown stream key' });
  if (!streamer.multistream_enabled) {
    return res.json({ ok: true, forwarded: false, reason: 'disabled' });
  }

  const dests = [];
  if (streamer.multistream_twitch_key_enc) {
    const k = decryptKey(streamer.multistream_twitch_key_enc, config.multistream.keySecret);
    dests.push({ name: 'twitch', url: `${TWITCH_INGEST}/${k}` });
  }
  if (streamer.multistream_kick_key_enc) {
    const k = decryptKey(streamer.multistream_kick_key_enc, config.multistream.keySecret);
    dests.push({ name: 'kick', url: `${KICK_INGEST}/${k}` });
  }
  if (dests.length === 0) {
    return res.json({ ok: true, forwarded: false, reason: 'no destinations' });
  }

  try {
    await relay.addForwardPaths({
      apiUrl: config.multistream.apiUrl,
      apiToken: config.multistream.apiToken,
      sourceToken: token,
      destinations: dests,
    });
    db.markMultistreamStarted(streamer.id);
    res.json({ ok: true, forwarded: true, destinations: dests.map((d) => d.name) });
  } catch (err) {
    console.error('[multistream] addForwardPaths failed:', err.message);
    res.status(500).json({ error: 'relay add failed' });
  }
});

router.post('/webhook/on-not-ready', express.json(), async (req, res) => {
  const auth = req.get('Authorization') || '';
  if (auth !== `Bearer ${config.multistream.webhookSecret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const path = (req.body && req.body.path) || '';
  const token = path.replace(/^live\//, '');
  if (!token) return res.status(400).json({ error: 'missing path' });

  try {
    await relay.removeForwardPaths({
      apiUrl: config.multistream.apiUrl,
      apiToken: config.multistream.apiToken,
      sourceToken: token,
      destinationNames: ['twitch', 'kick'],
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[multistream] removeForwardPaths failed:', err.message);
    res.status(500).json({ error: 'relay remove failed' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Mount the router in `src/server.js`**

Find where the existing dashboard router is mounted (search for `require('./routes/dashboard')`). Add immediately after:

```js
app.use('/dashboard/multistream', require('./routes/multistream'));
app.use('/api/multistream', require('./routes/multistream'));
```

The first mount serves the streamer-facing page (`GET /` and `POST /save`). The second mount makes the MediaMTX webhook reachable at `/api/multistream/webhook/on-ready` and `/api/multistream/webhook/on-not-ready`. They share the same router safely because the path namespaces (`/`, `/save`, `/webhook/*`) don't collide.

- [ ] **Step 3: Boot and confirm the route is mounted**

Run: `npm run dev`
Then: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/dashboard/multistream`
Expected: 302 redirect (because no session cookie) — confirms the route is mounted but auth is enforced.

Test the webhook auth:
`curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/multistream/webhook/on-ready -H "Content-Type: application/json" -d '{}'`
Expected: 401 (no Authorization header).

Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/routes/multistream.js src/server.js
git commit -m "feat(multistream): routes for dashboard, save, and MediaMTX webhooks"
```

---

## Task 5: Dashboard view (`multistream.ejs`)

**Files:**
- Create: `src/views/multistream.ejs`

- [ ] **Step 1: Write the view**

Create `src/views/multistream.ejs`:

```ejs
<%- include('header', { title: 'Multistream', streamer: streamer }) %>

<a href="/dashboard" style="color: var(--text-secondary); font-size: 13px; font-family: var(--font-display); font-weight: 500; display: inline-flex; align-items: center; gap: 6px;">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
  Back to Dashboard
</a>
<h2 style="margin: 16px 0 8px; font-size: 24px; font-weight: 700;" class="animate-in">Multistream</h2>
<p style="color: var(--text-secondary); font-size: 14px; margin-bottom: 24px;">
  Stream once from OBS — we relay it to Twitch and Kick at the same time. No extra CPU or upload bandwidth on your PC.
</p>

<% if (typeof query !== 'undefined' && query && query.saved) { %>
  <div class="alert alert-success animate-in">Settings saved.</div>
<% } %>

<% if (!relayConfigured) { %>
  <div class="alert alert-warning animate-in">
    Multistream relay is not configured on the server yet. Ask the admin to set <code>MEDIAMTX_API_URL</code> and <code>MULTISTREAM_KEY_SECRET</code>.
  </div>
<% } %>

<form method="POST" action="/dashboard/multistream/save">

  <div class="card animate-in animate-in-delay-1">
    <div style="display: flex; align-items: center; justify-content: space-between;">
      <div>
        <h3>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
          Enable Multistream
        </h3>
        <p style="color: var(--text-muted); font-size: 13px; margin-top: 8px;">When on, every stream you push to the ingest URL below is forwarded to Twitch + Kick.</p>
      </div>
      <label class="pill-toggle">
        <input type="checkbox" name="enabled" value="1" <%= multistream.multistream_enabled ? 'checked' : '' %>>
        <span class="slider"></span>
      </label>
    </div>
  </div>

  <div class="card animate-in animate-in-delay-2">
    <h3>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
      Your Ingest URL
    </h3>
    <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 12px;">Open OBS → Settings → Stream → Service: <strong>Custom</strong>. Paste these two values:</p>

    <div class="form-group">
      <label>Server</label>
      <div style="display: flex; gap: 8px;">
        <input id="ms-server" type="text" value="<%= ingestUrl %>" readonly style="flex: 1; font-family: ui-monospace, monospace; font-size: 13px;">
        <button type="button" class="btn btn-secondary" onclick="copyVal('ms-server', this)">Copy</button>
      </div>
    </div>

    <div class="form-group" style="margin-bottom: 0;">
      <label>Stream Key</label>
      <div style="display: flex; gap: 8px;">
        <input id="ms-key" type="password" value="<%= streamKey %>" readonly style="flex: 1; font-family: ui-monospace, monospace; font-size: 13px;">
        <button type="button" class="btn btn-secondary" onclick="toggleReveal('ms-key', this)">Show</button>
        <button type="button" class="btn btn-secondary" onclick="copyVal('ms-key', this)">Copy</button>
      </div>
      <p style="color: var(--text-muted); font-size: 12px; margin-top: 8px;">Treat this like a password — anyone with it can stream as you.</p>
    </div>
  </div>

  <div class="card animate-in animate-in-delay-3">
    <h3>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      Destinations
    </h3>

    <div style="border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 16px; margin: 12px 0;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 28px; height: 28px; border-radius: 6px; background: #9146ff; display: flex; align-items: center; justify-content: center; font-weight: 700; color: white;">T</div>
          <div>
            <div style="font-weight: 600; font-size: 14px;">Twitch</div>
            <div style="font-size: 12px; color: var(--text-muted);">
              <% if (hasTwitchKey) { %>Stream key saved · enter a new value to replace<% } else { %>No stream key set<% } %>
            </div>
          </div>
        </div>
        <% if (hasTwitchKey) { %>
          <label style="font-size: 11px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 6px;">
            <input type="checkbox" onchange="if(this.checked) document.getElementById('twitch_key').value='__clear__'; else document.getElementById('twitch_key').value='';"> Remove key
          </label>
        <% } %>
      </div>
      <input id="twitch_key" type="password" name="twitch_key" placeholder="<%= hasTwitchKey ? '••••••••• (leave empty to keep current)' : 'live_xxxxxxxxxxxxxxxxxxxxxxxxx' %>" style="width: 100%; font-family: ui-monospace, monospace; font-size: 13px;">
      <p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">Find your key at <a href="https://dashboard.twitch.tv/settings/stream" target="_blank" rel="noopener">dashboard.twitch.tv/settings/stream</a></p>
    </div>

    <div style="border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 16px; margin: 12px 0;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 28px; height: 28px; border-radius: 6px; background: #53fc18; display: flex; align-items: center; justify-content: center; font-weight: 700; color: black;">K</div>
          <div>
            <div style="font-weight: 600; font-size: 14px;">Kick</div>
            <div style="font-size: 12px; color: var(--text-muted);">
              <% if (hasKickKey) { %>Stream key saved · enter a new value to replace<% } else { %>No stream key set<% } %>
            </div>
          </div>
        </div>
        <% if (hasKickKey) { %>
          <label style="font-size: 11px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 6px;">
            <input type="checkbox" onchange="if(this.checked) document.getElementById('kick_key').value='__clear__'; else document.getElementById('kick_key').value='';"> Remove key
          </label>
        <% } %>
      </div>
      <input id="kick_key" type="password" name="kick_key" placeholder="<%= hasKickKey ? '••••••••• (leave empty to keep current)' : 'sk_xxxxxxxxxxxxxxxxxxxxxxxxx' %>" style="width: 100%; font-family: ui-monospace, monospace; font-size: 13px;">
      <p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">Find your key at <a href="https://kick.com/dashboard/settings/stream" target="_blank" rel="noopener">kick.com/dashboard/settings/stream</a></p>
    </div>
  </div>

  <div style="display: flex; justify-content: flex-end; margin: 24px 0;">
    <button type="submit" class="btn btn-primary" style="padding: 12px 32px; font-size: 14px;">
      Save Settings
    </button>
  </div>
</form>

<style>
  .pill-toggle { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
  .pill-toggle input { opacity: 0; width: 0; height: 0; }
  .pill-toggle .slider { position: absolute; cursor: pointer; inset: 0; background: var(--bg-elevated); border-radius: 24px; border: 1px solid var(--border); transition: 0.3s; }
  .pill-toggle .slider:before { content: ''; position: absolute; height: 18px; width: 18px; left: 2px; bottom: 2px; background: #fff; border-radius: 50%; transition: 0.3s; }
  .pill-toggle input:checked + .slider { background: var(--accent); border-color: var(--accent); }
  .pill-toggle input:checked + .slider:before { transform: translateX(20px); }
</style>

<script>
  function copyVal(id, btn) {
    const el = document.getElementById(id);
    navigator.clipboard.writeText(el.value);
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = orig, 1500);
  }
  function toggleReveal(id, btn) {
    const el = document.getElementById(id);
    if (el.type === 'password') { el.type = 'text'; btn.textContent = 'Hide'; }
    else { el.type = 'password'; btn.textContent = 'Show'; }
  }
</script>

<%- include('footer') %>
```

- [ ] **Step 2: Boot and verify the page renders for a logged-in user**

Run: `npm run dev`. In a browser logged in as a streamer, visit `http://localhost:3000/dashboard/multistream`.
Expected: page renders with Enable toggle, Ingest URL section, two destination cards. The relay-not-configured warning shows because env vars are unset locally — that's expected.

Stop the server.

- [ ] **Step 3: Commit**

```bash
git add src/views/multistream.ejs
git commit -m "feat(multistream): dashboard page for ingest URL + stream keys"
```

---

## Task 6: Dashboard card link

**Files:**
- Modify: `src/views/dashboard.ejs` (add a card alongside the Donations card around line 468)

- [ ] **Step 1: Add the card right after the Donations Card block**

Locate the `<!-- Donations Card -->` block in `src/views/dashboard.ejs` (around line 468). After its closing `</div>` (the wrapper card div, NOT the inner header div), insert:

```ejs
<!-- Multistream Card -->
<div class="card" style="display: flex; flex-direction: column;">
  <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
    <div style="width: 36px; height: 36px; border-radius: 8px; background: linear-gradient(135deg, #9146ff, #53fc18); display: flex; align-items: center; justify-content: center;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
    </div>
    <div>
      <h3 style="font-size: 16px; font-weight: 700; margin: 0;">Multistream</h3>
      <span style="color: var(--text-muted); font-size: 12px;">Twitch + Kick at the same time</span>
    </div>
  </div>
  <% if (streamer.multistream_enabled) { %>
    <p style="color: var(--success); font-size: 13px; margin-bottom: 12px; flex: 1;">
      <span class="status-dot online"></span>Active — point OBS at your ingest URL.
    </p>
  <% } else { %>
    <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 12px; flex: 1;">
      Stream once, broadcast to Twitch and Kick. Zero extra CPU.
    </p>
  <% } %>
  <a href="/dashboard/multistream" class="btn btn-primary" style="font-size: 13px; padding: 8px 16px; text-decoration: none; margin-top: auto;">Open Multistream</a>
</div>
```

If the dashboard route handler in `src/routes/dashboard.js` explicitly picks streamer fields (instead of passing the whole row), add `multistream_enabled` to the picked list. If it passes the whole row, no change needed — the new column comes through automatically after the migration.

- [ ] **Step 2: Verify the dashboard renders with the card**

Run: `npm run dev`. Visit `/dashboard` as a streamer, click the Twitch tab.
Expected: the Multistream card appears next to the Donations card.

Stop the server.

- [ ] **Step 3: Commit**

```bash
git add src/views/dashboard.ejs
git commit -m "feat(multistream): dashboard card linking to settings"
```

---

## Task 7: Playwright E2E for the dashboard page

**Files:**
- Create: `tests/multistream.spec.js`

- [ ] **Step 1: Read the existing auth fixture**

Open `tests/authenticated.spec.js` and copy the auth setup pattern (likely a `beforeEach` that seeds a streamer + sets a session cookie or hits a test-only login endpoint). The exact mechanism is project-specific — replicate whatever pattern you find there.

- [ ] **Step 2: Write the E2E test**

Create `tests/multistream.spec.js`:

```js
const { test, expect } = require('@playwright/test');

test.describe('Multistream dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Mirror the auth pattern from tests/authenticated.spec.js exactly.
    // (Different projects use different mechanisms — copy what's there.)
  });

  test('redirects unauthenticated users to /streamer', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/dashboard/multistream');
    expect(page.url()).toContain('/streamer');
  });

  test('renders ingest URL and stream key for logged-in streamer', async ({ page }) => {
    await page.goto('/dashboard/multistream');
    await expect(page.locator('h2', { hasText: 'Multistream' })).toBeVisible();
    await expect(page.locator('#ms-server')).toHaveValue(/rtmp:\/\//);
    await expect(page.locator('#ms-key')).toHaveValue(/.{20,}/);
  });

  test('saves Twitch + Kick keys and shows confirmation', async ({ page }) => {
    await page.goto('/dashboard/multistream');
    await page.locator('input[name="twitch_key"]').fill('live_test_key_twitch');
    await page.locator('input[name="kick_key"]').fill('sk_test_key_kick');
    await page.locator('input[name="enabled"]').check();
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/saved=1/);
    await expect(page.locator('.alert-success')).toContainText('saved');
  });

  test('reveals stream key when Show is clicked', async ({ page }) => {
    await page.goto('/dashboard/multistream');
    await expect(page.locator('#ms-key')).toHaveAttribute('type', 'password');
    await page.locator('button', { hasText: 'Show' }).first().click();
    await expect(page.locator('#ms-key')).toHaveAttribute('type', 'text');
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx playwright test tests/multistream.spec.js`
Expected: PASS — 4 tests pass (after the auth fixture is wired in step 1).

- [ ] **Step 4: Commit**

```bash
git add tests/multistream.spec.js
git commit -m "test(multistream): playwright E2E for dashboard page"
```

---

## Task 8: Operator setup docs (Oracle Cloud + MediaMTX)

**Files:**
- Create: `docs/multistream-relay-setup.md`

- [ ] **Step 1: Write the setup doc**

Create `docs/multistream-relay-setup.md`:

````markdown
# Multistream Relay Setup (Oracle Cloud + MediaMTX)

This document is for the operator (you). The streamer-facing UI is at `/dashboard/multistream` — none of this leaks there.

## Why this is free

Oracle Cloud's "Always Free" tier gives one ARM Ampere A1 VM (4 vCPU / 24 GB RAM) and **10 TB of egress per month, forever**. Two-destination passthrough at 6 Mbps ≈ 5.4 GB/hour per active streamer — the cap covers ~1,850 streamer-hours/month before any spend.

## 1. Provision the VM

1. Sign up at oracle.com/cloud/free.
2. Create a VM:
   - Shape: `VM.Standard.A1.Flex` — 2 OCPU / 12 GB is enough.
   - Image: Ubuntu 22.04 minimal.
   - Region: São Paulo (closest to most users).
   - Network: public IPv4 + open ports 1935 (RTMP) and 443 (TLS reverse proxy). Keep 9997 closed to the public internet.
3. DNS: add A record `ingest.atletanotifications.com` → VM public IP. Cloudflare proxy must be **off** (Cloudflare doesn't proxy raw RTMP).

## 2. Install MediaMTX + ffmpeg

```bash
ssh ubuntu@<vm-ip>
sudo apt update && sudo apt install -y ffmpeg curl
ARCH=arm64v8
VER=1.8.0  # check https://github.com/bluenviron/mediamtx/releases
curl -L https://github.com/bluenviron/mediamtx/releases/download/v${VER}/mediamtx_v${VER}_linux_${ARCH}.tar.gz | sudo tar -xz -C /usr/local/bin mediamtx
sudo useradd -r -s /bin/false mediamtx
sudo mkdir -p /etc/mediamtx
```

## 3. Configure MediaMTX

`/etc/mediamtx/mediamtx.yml`:

```yaml
logLevel: info
logDestinations: [stdout]

rtmp: yes
rtmpAddress: :1935

hls: no
webrtc: no
srt: no
rtsp: no

api: yes
apiAddress: 127.0.0.1:9997
authInternalUsers:
  - user: admin
    pass: <STRONG_RANDOM_PASSWORD>   # mirror in MEDIAMTX_API_TOKEN on Railway
    permissions:
      - action: api

runOnReady: 'curl -s -X POST -H "Authorization: Bearer <SHARED_SECRET>" -H "Content-Type: application/json" -d ''{"path":"$MTX_PATH"}'' https://atletanotifications.com/api/multistream/webhook/on-ready'
runOnNotReady: 'curl -s -X POST -H "Authorization: Bearer <SHARED_SECRET>" -H "Content-Type: application/json" -d ''{"path":"$MTX_PATH"}'' https://atletanotifications.com/api/multistream/webhook/on-not-ready'

paths:
  ~^live/.*$:
    source: publisher
```

Generate two `openssl rand -hex 32` values: one for `<STRONG_RANDOM_PASSWORD>` (becomes `MEDIAMTX_API_TOKEN`), one for `<SHARED_SECRET>` (becomes `MEDIAMTX_WEBHOOK_SECRET`).

## 4. Run as systemd

`/etc/systemd/system/mediamtx.service`:

```ini
[Unit]
Description=MediaMTX
After=network.target

[Service]
ExecStart=/usr/local/bin/mediamtx /etc/mediamtx/mediamtx.yml
User=mediamtx
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mediamtx
sudo systemctl status mediamtx
```

## 5. Expose the API to Railway

The API binds to `127.0.0.1:9997` on purpose. Railway needs to reach it. Recommended: Cloudflare Tunnel.

```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb
sudo cloudflared service install <YOUR_TUNNEL_TOKEN>
```

In Cloudflare dashboard: create a tunnel, route `relay.atletanotifications.com` → `http://localhost:9997`. Add Cloudflare Access policy with a service token; the Railway app sends that token.

Set on Railway: `MEDIAMTX_API_URL=https://relay.atletanotifications.com`.

## 6. Set Railway env vars

```
MEDIAMTX_API_URL=https://relay.atletanotifications.com
MEDIAMTX_INGEST_URL=rtmp://ingest.atletanotifications.com/live
MEDIAMTX_API_TOKEN=<the password from mediamtx.yml>
MEDIAMTX_WEBHOOK_SECRET=<the shared secret from mediamtx.yml>
MULTISTREAM_KEY_SECRET=<openssl rand -hex 32>
```

## 7. End-to-end smoke test

1. OBS on a test machine: Settings → Stream → Custom. Server: `rtmp://ingest.atletanotifications.com/live`. Stream key: copy from `/dashboard/multistream` (test account, multistream enabled).
2. Set test account's Twitch + Kick keys (use throwaway channels).
3. Start streaming.
4. Within ~10s — live on Twitch + Kick.
5. Stop streaming → both go offline within ~10s.

## 8. Egress monitoring (manual until automated)

Check Oracle Cloud's "Networking → Bandwidth" weekly. If approaching 10 TB before month end, temporarily disable globally by unsetting `MEDIAMTX_API_URL` on Railway — new streams won't be forwarded; existing streams continue until they end.

## 9. Heartbeat against Always-Free reclamation

Add to crontab on the VM (`crontab -e -u ubuntu`):

```
* * * * * curl -s https://atletanotifications.com/healthz > /dev/null
```

Keeps the network interface busy enough for Oracle's idle detection.
````

- [ ] **Step 2: Commit**

```bash
git add docs/multistream-relay-setup.md
git commit -m "docs(multistream): operator setup guide for Oracle Cloud + MediaMTX"
```

---

## Task 9: Document in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the new files to the Project Structure block**

Insert into the appropriate sections of the `## Project Structure` tree:
- `src/services/multistreamRelay.js` next to other services with: `# MediaMTX HTTP API client — adds/removes per-streamer RTMP forwarder paths`
- `src/services/streamKeyCrypto.js`: `# AES-256-GCM helpers for at-rest encryption of platform stream keys`
- `src/routes/multistream.js` next to other routes: `# Multistream dashboard page + MediaMTX webhooks (on-ready / on-not-ready)`
- `src/views/multistream.ejs` next to other views: `# Streamer-facing UI for ingest URL + Twitch/Kick key management`

- [ ] **Step 2: Add a "Multistream" bullet to Key Architecture**

After the Donations bullet:

> **Multistream (Twitch + Kick passthrough):** Streamer points OBS at our ingest URL (`rtmp://ingest.atletanotifications.com/live/<token>`) which terminates on a MediaMTX server we host on Oracle Cloud Free Tier. MediaMTX hits `/api/multistream/webhook/on-ready` when a stream starts; the webhook decrypts the streamer's Twitch + Kick keys and tells MediaMTX (via its HTTP API) to spawn one `ffmpeg -c copy` forwarder per destination. No re-encoding — bytes pass through. Stream keys stored AES-256-GCM encrypted at rest in `streamers.multistream_*_key_enc` (key from `MULTISTREAM_KEY_SECRET`). See `docs/multistream-relay-setup.md` for the operator side. Free at scale via Oracle's 10 TB/mo egress allowance — ~1,850 streamer-hours/month at 2 destinations.

- [ ] **Step 3: Add the new env vars to Environment Variables**

Under "Optional":

```
- MEDIAMTX_API_URL, MEDIAMTX_INGEST_URL, MEDIAMTX_API_TOKEN, MEDIAMTX_WEBHOOK_SECRET — multistream relay coordinates
- MULTISTREAM_KEY_SECRET — 64-char hex (32 bytes) for AES-GCM encryption of stored stream keys
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): document multistream relay architecture + env vars"
```

---

## Acceptance Criteria

The feature is shippable when **all** of these are true:

1. A logged-in streamer can visit `/dashboard/multistream`, see their personal ingest URL + stream key, paste a Twitch and a Kick stream key, toggle multistream on, and save.
2. Setting OBS to that ingest URL + key and starting a stream results in the stream being live on Twitch + Kick within 15 seconds, with no re-encoding (`ffmpeg -c copy`).
3. Stopping the stream in OBS causes both platforms to go offline within 15 seconds.
4. Stream keys in the database are AES-GCM encrypted (verifiable by reading the `streamers.multistream_twitch_key_enc` column directly — the value is not the plaintext key).
5. The MediaMTX webhooks reject any request without the correct `Authorization: Bearer <secret>` header.
6. The Playwright E2E suite passes.
7. The setup doc lets a fresh operator stand up the relay end-to-end without asking for help.

## Risks and unknowns

- **Kick RTMP ingest URL changes.** Kick has rotated their ingest endpoint twice in 2025. Hard-coded `KICK_INGEST` in `src/routes/multistream.js` may need a CLAUDE.md note + a quick PR if it breaks. Consider env-configurable in v2.
- **MediaMTX `runOnReady` semantics.** This plan uses MediaMTX's path-add API with `runOnReady: ffmpeg ...` for fan-out. If MediaMTX's release at integration time forbids this (some versions limit `runOnReady` to read-only commands), fall back to: webhook on Railway SSHs into the relay VM and spawns ffmpeg directly. Worse but works.
- **Webhook reachability.** MediaMTX on Oracle → webhook on Railway requires Railway's HTTPS endpoint to be reachable. Verified in step 7 of the setup doc.
- **Single point of failure.** One Oracle VM = one failure domain. Acceptable for MVP; revisit if uptime matters.
