'use strict';

// The tip routes end to end: a real Express app serving src/routes/tip.js, the
// real src/db.js on an in-memory SQLite database, and a stubbed fetch standing
// in for PayPal, so nothing leaves the machine. All values are synthetic.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

const SRC = path.join(__dirname, '..');
const DB_FILE = path.join(SRC, 'db.js');
const TIP_FILE = path.join(__dirname, 'tip.js');
const PAYPAL = 'https://paypal.test';

const configStub = {
  adminDiscordIds: [],
  paypal: { clientId: 'test-client', clientSecret: 'test-secret', baseUrl: PAYPAL },
  app: { url: 'http://tips.test' },
};

const chatSends = [];
const logs = [];
let db;
let bus;
let t;
let server;
let port;
let streamerA;
let streamerB;
let streamerC; // switched off by an admin in the disabled-account tests
let tipRoutes;
const saved = {};

// ── Fake PayPal ──────────────────────────────────────────────────────

const ALREADY_CAPTURED = { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }], debug_id: 'dbg1' };
const IN_PROGRESS = { name: 'CONFLICT', details: [{ issue: 'PREVIOUS_REQUEST_IN_PROGRESS' }], debug_id: 'dbg2' };
let paypal;
const otherRequests = []; // anything fetched that is not PayPal (ElevenLabs included): must stay empty

// An order the buyer approved that PayPal has not captured (yet).
function approvedOrder(id) {
  return { id, status: 'APPROVED', purchase_units: [{ reference_id: 'default', payee: { email_address: 'tips-a@example.com', merchant_id: 'MERCHANT12345' } }] };
}

function reply(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// A captured order as PayPal returns it (capture with return=representation, or GET).
function completedOrder(id, over = {}) {
  return {
    id,
    status: 'COMPLETED',
    purchase_units: [{
      reference_id: 'default',
      payee: over.payee || { email_address: 'tips-a@example.com', merchant_id: 'MERCHANT12345' },
      payments: {
        captures: [{ id: `CAP-${id}`, status: over.captureStatus || 'COMPLETED', amount: { currency_code: 'EUR', value: '7.00' } }],
      },
    }],
  };
}

function resetPayPal() {
  paypal = {
    calls: [],
    nextOrder: 1,
    capture: (id) => reply(201, completedOrder(id)),
    getOrder: (id) => reply(200, completedOrder(id)),
  };
}

async function fakeFetch(url, opts = {}) {
  url = String(url);
  if (!url.startsWith(`${PAYPAL}/`)) {
    otherRequests.push(url);
    throw new Error(`unexpected request to ${url}`);
  }
  paypal.calls.push({
    url, method: opts.method || 'GET', prefer: opts.headers && opts.headers.Prefer,
    timeout: opts.signal instanceof AbortSignal, body: opts.body,
  });
  if (url === `${PAYPAL}/v1/oauth2/token`) return reply(200, { access_token: 'test-token' });
  if (url === `${PAYPAL}/v2/checkout/orders`) {
    const id = `TESTORDER${String(paypal.nextOrder++).padStart(8, '0')}`;
    const unit = JSON.parse(opts.body).purchase_units[0];
    return reply(201, {
      id,
      status: 'CREATED',
      purchase_units: [{ reference_id: 'default', amount: unit.amount, payee: { email_address: unit.payee.email_address, merchant_id: 'MERCHANT12345' } }],
      links: [{ rel: 'self', href: `${PAYPAL}/v2/checkout/orders/${id}` }, { rel: 'approve', href: `${PAYPAL}/checkoutnow?token=${id}` }],
    });
  }
  const m = url.match(/\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/);
  if (m && m[2]) return paypal.capture(m[1]);
  if (m) return paypal.getOrder(m[1]);
  throw new Error(`unexpected PayPal call ${url}`);
}

const captureCalls = () => paypal.calls.filter((c) => c.url.endsWith('/capture'));
const orderReads = () => paypal.calls.filter((c) => c.method === 'GET' && /\/v2\/checkout\/orders\/[^/]+$/.test(c.url));

// ── App ──────────────────────────────────────────────────────────────

function request(method, urlPath, form, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const body = form ? new URLSearchParams(form).toString() : null;
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method, agent: false,
      headers: { ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}), ...extraHeaders },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

before(async () => {
  saved.load = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    const from = parent && parent.filename;
    if (from === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      if (request === './config') return configStub;
    }
    if (from === TIP_FILE) {
      if (request === '../config') return configStub;
      // The real chat manager needs a Twitch connection; record what it would send.
      if (request === '../services/twitchChat') return { chatManager: { sendEventMessage: (...args) => chatSends.push(args) } };
    }
    return saved.load(request, parent, isMain);
  };
  // Migrations and the routes log to the console; keep them for assertions, not the output.
  saved.log = console.log;
  saved.error = console.error;
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => logs.push(args.join(' '));

  delete require.cache[DB_FILE];
  delete require.cache[TIP_FILE];
  db = require(DB_FILE);
  bus = require('../services/overlayBus');
  ({ t } = require('../i18n'));

  const add = db.db.prepare(`
    INSERT INTO streamers (discord_user_id, discord_username, twitch_username, paypal_email,
      donation_page_enabled, donation_min_amount, donation_currency)
    VALUES (?, ?, ?, ?, 1, 1, 'EUR')`);
  streamerA = Number(add.run('100000000000000001', 'a', 'tips_a', 'Tips-A@Example.com').lastInsertRowid);
  streamerB = Number(add.run('100000000000000002', 'b', 'tips_b', 'tips-b@example.com').lastInsertRowid);
  streamerC = Number(add.run('100000000000000003', 'c', 'tips_c', 'tips-c@example.com').lastInsertRowid);

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(SRC, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    // x-show-keys: every message comes back as its key, to see that none is typed into the page or the route;
    // x-test-lang: the language server.js would have set in res.locals.lang
    res.locals.t = req.get('x-show-keys') ? (key) => `[${key}]` : (key, params) => t('en', key, params);
    if (req.get('x-test-lang')) res.locals.lang = req.get('x-test-lang');
    next();
  });
  tipRoutes = require('./tip');
  app.use('/tip', tipRoutes);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;

  saved.fetch = global.fetch;
  global.fetch = fakeFetch;
});

after(async () => {
  global.fetch = saved.fetch;
  console.log = saved.log;
  console.error = saved.error;
  Module._load = saved.load;
  await new Promise((resolve) => server.close(resolve));
});

let alerts;
let goalUpdates;
beforeEach(() => {
  resetPayPal();
  chatSends.length = 0;
  logs.length = 0;
  db.db.exec('DELETE FROM pending_tips; DELETE FROM donations; DELETE FROM overlay_events; DELETE FROM tip_goals;');
  db.createTipGoal(streamerA, { title: 'Pedals', target_amount: 100, bar_color: '#22c55e', currency: 'EUR', current_amount: 0 });
  alerts = [];
  goalUpdates = [];
  bus.removeAllListeners(`overlay:${streamerA}`);
  bus.removeAllListeners(`overlay:${streamerB}`);
  bus.removeAllListeners(`tipgoal:${streamerA}`);
  bus.on(`overlay:${streamerA}`, (e) => alerts.push(e));
  bus.on(`overlay:${streamerB}`, (e) => alerts.push(e));
  bus.on(`tipgoal:${streamerA}`, (e) => { if (e.added) goalUpdates.push(e); });
});

// Starts a tip on a streamer's page and returns the PayPal order id.
async function startTip(username = 'tips_a', form = { amount: '5', donor_name: 'Viewer One', message: 'Keep racing' }) {
  const res = await request('POST', `/tip/${username}/create`, form);
  assert.equal(res.status, 302);
  return new URL(res.headers.location).searchParams.get('token');
}

const count = (table) => db.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

function assertNothingAnnounced() {
  assert.equal(alerts.length, 0, 'no overlay alert');
  assert.equal(chatSends.length, 0, 'no chat thank-you');
  assert.equal(goalUpdates.length, 0, 'no goal update');
  assert.equal(count('donations'), 0, 'no history row');
  assert.equal(count('overlay_events'), 0, 'no overlay stat');
}

function assertAnnouncedOnce() {
  assert.equal(alerts.length, 1, 'one overlay alert');
  assert.equal(chatSends.length, 1, 'one chat thank-you');
  assert.equal(goalUpdates.length, 1, 'one goal update');
  assert.equal(count('donations'), 1, 'one history row');
  assert.equal(count('overlay_events'), 1, 'one overlay stat');
  assert.equal(db.getActiveTipGoal(streamerA).current_amount, 7);
}

const THANK_YOU = '/tip/tips_a?success=1';

describe('POST /tip/:username/create', () => {
  test('keeps the donor on the server and sets no cookies', async () => {
    const res = await request('POST', '/tip/tips_a/create', { amount: '5', donor_name: 'Viewer One', message: 'Keep\r\nracing' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, `${PAYPAL}/checkoutnow?token=TESTORDER00000001`);
    assert.equal(res.headers['set-cookie'], undefined);
    const pending = db.getPendingTip('TESTORDER00000001');
    assert.equal(pending.streamer_id, streamerA);
    assert.equal(pending.donor_name, 'Viewer One');
    assert.equal(pending.message, 'Keep  racing');
    assert.equal(pending.payee_merchant_id, 'MERCHANT12345');
    assert.equal(pending.captured_at, null);
    const create = paypal.calls.find((c) => c.url === `${PAYPAL}/v2/checkout/orders`);
    assert.equal(create.prefer, 'return=representation');
    assert.equal(create.timeout, true);
    const unit = JSON.parse(create.body).purchase_units[0];
    assert.deepEqual(unit.amount, { currency_code: 'EUR', value: '5.00' });
    assert.equal(unit.payee.email_address, 'Tips-A@Example.com');
  });

  test('an amount below the minimum is refused before PayPal is called', async () => {
    const res = await request('POST', '/tip/tips_a/create', { amount: '0.5' });
    assert.equal(res.status, 400);
    assert.equal(paypal.calls.length, 0);
    assert.equal(count('pending_tips'), 0);
  });
});

describe('GET /tip/:username/success', () => {
  test('a verified capture alerts, thanks, counts and records exactly once', async () => {
    const order = await startTip();
    const res = await request('GET', `/tip/tips_a/success?token=${order}&PayerID=PAYER1`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, THANK_YOU);
    assertAnnouncedOnce();
    assert.deepEqual(alerts[0], { type: 'donation', data: { username: 'Viewer One', amount: 7, message: 'Keep racing', currency: 'EUR' } });
    assert.deepEqual(chatSends[0], [streamerA, 'donation', { username: 'Viewer One', amount: 'EUR 7', message: 'Keep racing' }]);
    const row = db.db.prepare('SELECT * FROM donations').get();
    assert.equal(row.source, 'paypal');
    assert.equal(row.external_id, order);
    assert.equal(row.amount, 7);
    const capture = captureCalls()[0];
    assert.equal(capture.prefer, 'return=representation');
    assert.equal(capture.timeout, true);

    // Reloading the return URL is a no-op that still thanks the viewer.
    const again = await request('GET', `/tip/tips_a/success?token=${order}&PayerID=PAYER1`);
    assert.equal(again.status, 302);
    assert.equal(again.headers.location, THANK_YOU);
    assertAnnouncedOnce();
    assert.equal(captureCalls().length, 1);
    assert.equal(orderReads().length, 0);
  });

  test('with TTS off the alert still fires at once: no voice, no status, nothing synthesized', async () => {
    otherRequests.length = 0;
    const order = await startTip();
    await request('GET', `/tip/tips_a/success?token=${order}&PayerID=PAYER1`);
    assertAnnouncedOnce();
    assert.deepEqual(alerts[0], { type: 'donation', data: { username: 'Viewer One', amount: 7, message: 'Keep racing', currency: 'EUR' } });
    assert.equal(db.db.prepare('SELECT tts_status FROM donations').get().tts_status, null);
    assert.deepEqual(otherRequests, []);
  });

  test('with TTS on and the overlay not open in OBS the alert fires without a voice and the tip says why', async () => {
    otherRequests.length = 0;
    db.db.prepare('UPDATE streamers SET tts_enabled = 1, overlay_enabled = 1, overlay_donation_enabled = 1 WHERE id = ?').run(streamerA);
    try {
      const order = await startTip();
      await request('GET', `/tip/tips_a/success?token=${order}&PayerID=PAYER1`);
      assertAnnouncedOnce();
      assert.deepEqual(alerts[0].data, { username: 'Viewer One', amount: 7, message: 'Keep racing', currency: 'EUR' });
      assert.equal(db.db.prepare('SELECT tts_status FROM donations').get().tts_status, 'overlay_closed');
      assert.deepEqual(otherRequests, []);
    } finally {
      db.db.prepare('UPDATE streamers SET tts_enabled = 0, overlay_enabled = 0 WHERE id = ?').run(streamerA);
    }
  });

  test('a lost capture answer is recovered from the order and counted once', async () => {
    const order = await startTip();
    paypal.capture = () => { throw new Error('The operation was aborted due to timeout'); };
    const res = await request('GET', `/tip/tips_a/success?token=${order}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, THANK_YOU);
    assert.equal(orderReads().length, 1);
    assert.equal(orderReads()[0].timeout, true);
    assertAnnouncedOnce();
  });

  test('a PayPal server error on capture is resolved by reading the order', async () => {
    const order = await startTip();
    paypal.capture = () => reply(503, { name: 'SERVICE_UNAVAILABLE' });
    const res = await request('GET', `/tip/tips_a/success?token=${order}`);
    assert.equal(res.headers.location, THANK_YOU);
    assert.equal(orderReads().length, 1);
    assertAnnouncedOnce();
  });

  test('already captured and already recorded: thank-you page, nothing announced again', async () => {
    const order = await startTip();
    db.logDonation(streamerA, { source: 'paypal', donor_name: 'Viewer One', amount: 7, currency: 'EUR', external_id: order });
    paypal.capture = () => reply(422, ALREADY_CAPTURED);
    const res = await request('GET', `/tip/tips_a/success?token=${order}`);
    assert.equal(res.headers.location, THANK_YOU);
    assert.equal(alerts.length, 0);
    assert.equal(chatSends.length, 0);
    assert.equal(count('donations'), 1);
    assert.ok(logs.some((l) => l.includes('was already in the donation history')));
    assert.ok(db.getPendingTip(order).captured_at);
  });

  test('a database error answers 500, and a reload records the tip once', async () => {
    const order = await startTip();
    const logDonation = db.logDonation;
    db.logDonation = () => { throw new Error('database is locked'); };
    let res;
    try {
      res = await request('GET', `/tip/tips_a/success?token=${order}`);
    } finally {
      db.logDonation = logDonation;
    }
    assert.equal(res.status, 500);
    assert.ok(res.text.includes(t('en', 'tip.error.notRecorded')));
    assert.ok(logs.some((l) => l.includes('not counted: log_failed')));
    assertNothingAnnounced();
    assert.equal(db.getPendingTip(order).captured_at, null);

    paypal.capture = () => reply(422, ALREADY_CAPTURED); // PayPal took the money the first time
    const reload = await request('GET', `/tip/tips_a/success?token=${order}`);
    assert.equal(reload.headers.location, THANK_YOU);
    assertAnnouncedOnce();
  });

  describe('refused returns: status and message, nothing announced', () => {
    const cases = [
      { name: 'unknown order', status: 400, key: 'tip.error.expired', reason: 'no_pending',
        run: () => request('GET', '/tip/tips_a/success?token=TESTORDER99999999') },
      { name: 'malformed token', status: 400, key: 'tip.error.expired',
        run: () => request('GET', '/tip/tips_a/success?token=abc') },
      { name: 'an order from another streamer\'s page', status: 400, key: 'tip.error.expired', reason: 'streamer_mismatch',
        run: async () => request('GET', `/tip/tips_b/success?token=${await startTip('tips_a')}`) },
      { name: 'payee mismatch', status: 400, key: 'tip.error.notConfirmed', reason: 'payee_mismatch',
        setup: () => { paypal.capture = (id) => reply(201, completedOrder(id, { payee: { email_address: 'someone-else@example.com', merchant_id: 'OTHERMERCHANT' } })); },
        run: async () => request('GET', `/tip/tips_a/success?token=${await startTip()}`) },
      { name: 'declined capture', status: 400, key: 'tip.error.notConfirmed', reason: 'not_completed',
        setup: () => { paypal.capture = (id) => reply(201, completedOrder(id, { captureStatus: 'DECLINED' })); },
        run: async () => request('GET', `/tip/tips_a/success?token=${await startTip()}`) },
      { name: 'PayPal unreachable', status: 502, key: 'tip.error.notConfirmedYet', reason: 'capture_failed',
        setup: () => {
          paypal.capture = () => { throw new Error('fetch failed'); };
          paypal.getOrder = () => { throw new Error('fetch failed'); };
        },
        run: async () => request('GET', `/tip/tips_a/success?token=${await startTip()}`) },
      { name: 'PayPal still capturing for another request', status: 502, key: 'tip.error.notConfirmedYet', reason: 'capture_failed',
        setup: () => {
          paypal.capture = () => reply(409, IN_PROGRESS);
          paypal.getOrder = (id) => reply(200, approvedOrder(id));
        },
        run: async () => request('GET', `/tip/tips_a/success?token=${await startTip()}`) },
    ];
    for (const c of cases) {
      test(c.name, async () => {
        if (c.setup) c.setup();
        const res = await c.run();
        assert.equal(res.status, c.status);
        assert.ok(res.text.includes('class="tip-alert"'), 'the tip page shows the error');
        assert.ok(res.text.includes(t('en', c.key)), c.key);
        if (c.reason) assert.ok(logs.some((l) => l.includes(`not counted: ${c.reason}`)), c.reason);
        assertNothingAnnounced();
        if (c.reason === 'no_pending' || c.reason === 'streamer_mismatch' || !c.reason) {
          assert.equal(captureCalls().length, 0, 'PayPal is not asked to capture');
        }
      });
    }
  });

  test('when the outcome is not known yet, the page asks for a reload and warns against paying again', () => {
    const message = t('en', 'tip.error.notConfirmedYet');
    assert.match(message, /reload this page/i);
    assert.match(message, /do not pay again/i);
  });

  test('a reload racing the first capture (PayPal: request in progress) reads the order and thanks the viewer once', async () => {
    const order = await startTip();
    paypal.capture = () => reply(409, IN_PROGRESS);
    const res = await request('GET', `/tip/tips_a/success?token=${order}`);
    assert.equal(res.headers.location, THANK_YOU);
    assert.equal(orderReads().length, 1);
    assertAnnouncedOnce();
  });
});

describe('an account an admin disabled', () => {
  const setEnabled = (on) => db.db.prepare('UPDATE streamers SET enabled = ? WHERE id = ?').run(on ? 1 : 0, streamerC);
  beforeEach(() => setEnabled(false));
  after(() => setEnabled(true));

  test('its tip page, order creation and returns answer like an unknown streamer', async () => {
    const pages = [
      ['GET', '/tip/tips_c', '/tip/nobody'],
      ['POST', '/tip/tips_c/create', '/tip/nobody/create'],
      ['GET', '/tip/tips_c/success?token=TESTORDER99999999', '/tip/nobody/success?token=TESTORDER99999999'],
    ];
    for (const [method, disabledPath, unknownPath] of pages) {
      const form = method === 'POST' ? { amount: '5' } : undefined;
      const disabled = await request(method, disabledPath, form);
      const unknown = await request(method, unknownPath, form);
      assert.equal(disabled.status, 404, disabledPath);
      assert.equal(disabled.status, unknown.status, disabledPath);
      assert.equal(disabled.text, unknown.text, disabledPath);
    }
    assert.equal(paypal.calls.length, 0);
    assert.equal(count('pending_tips'), 0);
  });

  test('an order started before it was disabled is still captured and recorded', async () => {
    setEnabled(true);
    const order = await startTip('tips_c');
    setEnabled(false);
    const res = await request('GET', `/tip/tips_c/success?token=${order}`);
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Thank you for your donation'), 'the viewer is thanked on the spot');
    assert.equal(captureCalls().length, 1);
    const rows = db.db.prepare('SELECT * FROM donations').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].streamer_id, streamerC);
    assert.equal(rows[0].external_id, order);
    assert.ok(db.getPendingTip(order).captured_at);

    const again = await request('GET', `/tip/tips_c/success?token=${order}`);
    assert.equal(again.status, 200);
    assert.equal(captureCalls().length, 1, 'a reload does not capture again');
    assert.equal(count('donations'), 1);
  });
});

describe('daily reconcile of tips PayPal captured but nobody recorded', () => {
  function addPending(orderId, hoursOld) {
    db.createPendingTip({ order_id: orderId, streamer_id: streamerA, donor_name: 'Viewer One', message: 'gg', payee_merchant_id: 'MERCHANT12345' });
    db.db.prepare("UPDATE pending_tips SET created_at = datetime('now', ?) WHERE order_id = ?").run(`-${Math.round(hoursOld * 60)} minutes`, orderId);
  }

  test('a captured order is recorded once, without an alert or chat; the next run does nothing', async () => {
    addPending('RECONCILE00000001', 3);
    assert.equal(await tipRoutes.reconcilePendingTips(), 1);
    assert.equal(count('donations'), 1);
    assert.equal(db.db.prepare('SELECT external_id FROM donations').get().external_id, 'RECONCILE00000001');
    assert.equal(db.getActiveTipGoal(streamerA).current_amount, 7);
    assert.equal(goalUpdates.length, 1, 'the goal counts it');
    assert.equal(alerts.length, 0, 'no stale overlay alert');
    assert.equal(chatSends.length, 0, 'no stale chat thank-you');
    assert.equal(count('overlay_events'), 0);
    assert.ok(db.getPendingTip('RECONCILE00000001').captured_at);
    assert.ok(logs.some((l) => l.includes('Recovered order RECONCILE00000001')));
    assert.equal(orderReads().length, 1);
    assert.equal(orderReads()[0].timeout, true);

    assert.equal(await tipRoutes.reconcilePendingTips(), 0);
    assert.equal(count('donations'), 1);
    assert.equal(goalUpdates.length, 1);
    assert.equal(orderReads().length, 1, 'a recorded tip is not read again');
  });

  test('uncaptured orders and failed reads are left, rows under an hour are skipped, rows over 24 h are still deleted', async () => {
    addPending('RECONCILE00000002', 2); // approved, never captured
    addPending('RECONCILE00000003', 5); // the order read fails
    addPending('RECONCILE00000004', 0.5); // too young: maybe still on its way back from PayPal
    addPending('RECONCILE00000005', 30); // over 24 h and not captured
    addPending('RECONCILE00000006', 26); // over 24 h and captured: its last chance before deletion
    paypal.getOrder = (id) => {
      if (id === 'RECONCILE00000003') throw new Error('fetch failed');
      if (id === 'RECONCILE00000002' || id === 'RECONCILE00000005') return reply(200, approvedOrder(id));
      return reply(200, completedOrder(id));
    };
    assert.equal(await tipRoutes.reconcilePendingTips(), 1);
    const read = orderReads().map((c) => c.url.split('/').pop());
    assert.ok(!read.includes('RECONCILE00000004'), 'rows under an hour old are not read');
    assert.deepEqual(db.db.prepare('SELECT external_id FROM donations').all().map((r) => r.external_id), ['RECONCILE00000006']);
    for (const id of ['RECONCILE00000002', 'RECONCILE00000003', 'RECONCILE00000004', 'RECONCILE00000005']) {
      assert.equal(db.getPendingTip(id).captured_at, null, id);
    }
    assert.ok(logs.some((l) => l.includes('RECONCILE00000003') && l.includes('fetch failed')));
    assert.equal(alerts.length, 0);

    db.cleanupOldPendingTips();
    const left = db.db.prepare('SELECT order_id FROM pending_tips ORDER BY order_id').all().map((r) => r.order_id);
    assert.deepEqual(left, ['RECONCILE00000002', 'RECONCILE00000003', 'RECONCILE00000004']);
  });
});

// ── The public page and its messages are in the visit's language ─────────────

describe('what a donor reads is translated', () => {
  const KEYS = { 'x-show-keys': '1' };

  test('every text on the page is a translated key, the language is the visit\'s, and the script gets the minimum in words', async () => {
    const res = await request('GET', '/tip/tips_a', undefined, { ...KEYS, 'x-test-lang': 'pt' });
    assert.equal(res.status, 200);
    assert.match(res.text, /<html lang="pt">/);
    for (const key of ['tip.pageTitle', 'tip.subtitle', 'tip.donateButton', 'tip.poweredBy']) {
      assert.ok(res.text.includes(`[${key}]`), key);
    }
    for (const key of ['tip.amountPlaceholder', 'tip.messagePlaceholder', 'tip.namePlaceholder']) {
      assert.ok(res.text.includes(`placeholder="[${key}]"`), key);
    }
    assert.ok(res.text.includes('const minMessage = "[tip.minAmount]";'), 'the minimum-donation message is rendered on the server');
    // nothing of the English wording is left typed into the page
    for (const english of ['Support this streamer', 'Donate via PayPal', 'Powered by', 'Minimum donation', 'optional']) {
      assert.ok(!res.text.includes(english), `"${english}" is not typed into the page`);
    }
  });

  test('the same page in English reads as before, with the minimum and the currency filled in', async () => {
    const res = await request('GET', '/tip/tips_a');
    assert.match(res.text, /<html lang="en">/);
    assert.ok(res.text.includes('Support this streamer with a donation'));
    assert.ok(res.text.includes('Donate via PayPal'));
    assert.ok(res.text.includes('const minMessage = "Minimum donation is 1 EUR";'));
    assert.ok(res.text.includes('<title>Donate to tips_a — Atleta</title>'));
  });

  test('the thank-you after a donation is translated', async () => {
    const res = await request('GET', '/tip/tips_a?success=1', undefined, KEYS);
    assert.ok(res.text.includes('[tip.thanks]'));
  });

  test('the plain-text answers of the routes are translated', async () => {
    const answer = async (method, urlPath, form) => {
      const res = await request(method, urlPath, form, KEYS);
      return [res.status, res.text];
    };
    assert.deepEqual(await answer('GET', '/tip/nobody'), [404, '[tip.error.pageUnavailable]']);
    assert.deepEqual(await answer('POST', '/tip/nobody/create', { amount: '5' }), [404, '[tip.error.pageUnavailable]']);
    assert.deepEqual(await answer('POST', '/tip/tips_a/create', { amount: '0.5' }), [400, '[tip.error.invalidAmount]']);
    assert.deepEqual(await answer('GET', '/tip/nobody/success?token=TESTORDER00000001'), [404, '[tip.error.streamerNotFound]']);
  });

  test('a payment that cannot be started says so in words', async () => {
    paypal.calls.length = 0;
    const original = global.fetch;
    global.fetch = async (url, opts = {}) => {
      if (String(url) === `${PAYPAL}/v2/checkout/orders`) return reply(500, { name: 'INTERNAL_SERVER_ERROR' });
      return original(url, opts);
    };
    try {
      const res = await request('POST', '/tip/tips_a/create', { amount: '5' }, KEYS);
      assert.equal(res.status, 500);
      assert.equal(res.text, '[tip.error.paymentFailed]');
    } finally {
      global.fetch = original;
    }
    assert.equal(count('pending_tips'), 0);
  });

  test('the order PayPal shows the donor is described in the visit\'s language', async () => {
    await request('POST', '/tip/tips_a/create', { amount: '5' }, KEYS);
    const create = paypal.calls.find((c) => c.url === `${PAYPAL}/v2/checkout/orders`);
    assert.equal(JSON.parse(create.body).purchase_units[0].description, '[tip.paypalDescription]');

    paypal.calls.length = 0;
    await request('POST', '/tip/tips_a/create', { amount: '5' });
    const english = paypal.calls.find((c) => c.url === `${PAYPAL}/v2/checkout/orders`);
    assert.equal(JSON.parse(english.body).purchase_units[0].description, 'Donation to tips_a');
  });

  test('a refused return shows its translated message on the page', async () => {
    const res = await request('GET', '/tip/tips_a/success?token=NOTANORDERID', undefined, KEYS);
    assert.equal(res.status, 400);
    assert.ok(res.text.includes('[tip.error.expired]'));
  });
});
