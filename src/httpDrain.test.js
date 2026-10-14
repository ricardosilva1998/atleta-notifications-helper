'use strict';

// The graceful stop (httpDrain.js) on a real HTTP server: a request in progress
// is allowed to finish, one that outlives the wait is cut off, an event stream
// is ended (OBS then reconnects to the new server), and no new connection is
// taken once the drain has started.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { createDrain } = require('./httpDrain');

// An app with the tracker first, as in server.js, plus the routes a test needs.
async function serve(drain, routes) {
  const app = express();
  app.use(drain.track);
  routes(app);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, port: server.address().port };
}

// Resolves when the response has ended (or the connection was cut).
function request(port, urlPath) {
  return new Promise((resolve) => {
    const result = { status: null, body: '', ended: false, error: null, headers: null };
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, agent: false }, (res) => {
      result.status = res.statusCode;
      result.headers = res.headers;
      res.setEncoding('utf8');
      res.on('data', (chunk) => { result.body += chunk; });
      res.on('end', () => { result.ended = true; resolve(result); });
      res.on('error', (e) => { result.error = e; resolve(result); });
    });
    req.on('error', (e) => { result.error = e; resolve(result); });
  });
}

const until = async (condition) => {
  for (let i = 0; i < 400 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(condition(), 'condition reached');
};

test('with nothing in progress, the drain is over at once and no new connection is taken', async () => {
  const drain = createDrain();
  const { server, port } = await serve(drain, (app) => app.get('/ok', (req, res) => res.send('ok')));
  assert.equal((await request(port, '/ok')).body, 'ok');
  await until(() => drain.inFlightCount() === 0);
  assert.equal(await drain.drain(server, { timeoutMs: 5000 }), 0);
  const refused = await request(port, '/ok');
  assert.equal(refused.error && refused.error.code, 'ECONNREFUSED');
});

test('a request in progress finishes before the drain is over', async () => {
  const drain = createDrain();
  let release;
  const { server, port } = await serve(drain, (app) => app.get('/slow', (req, res) => {
    release = () => res.send('captured');
  }));
  const pending = request(port, '/slow');
  await until(() => drain.inFlightCount() === 1);

  let drained = false;
  const done = drain.drain(server, { timeoutMs: 5000 }).then((unfinished) => { drained = true; return unfinished; });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(drained, false, 'still waiting for the request');
  release();

  const res = await pending;
  assert.equal(res.status, 200);
  assert.equal(res.body, 'captured', 'the answer was sent whole');
  assert.equal(await done, 0);
});

test('a request that outlives the wait is cut off, and the drain says how many were', async () => {
  const drain = createDrain();
  const { server, port } = await serve(drain, (app) => app.get('/never', () => {}));
  const pending = request(port, '/never');
  await until(() => drain.inFlightCount() === 1);
  const started = Date.now();
  assert.equal(await drain.drain(server, { timeoutMs: 150 }), 1);
  assert.ok(Date.now() - started >= 140, 'it waited the whole time');
  const res = await pending;
  assert.ok(res.error, 'the connection was closed');
});

test('an event stream is ended when the drain starts, and one opened afterwards is ended at once', async () => {
  const drain = createDrain();
  const { server, port } = await serve(drain, (app) => app.get('/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"type":"config"}\n\n');
    drain.holdStream(res);
  }));
  const stream = request(port, '/events');
  await until(() => drain.inFlightCount() === 1);
  assert.equal(await drain.drain(server, { timeoutMs: 5000 }), 0, 'the stream does not hold the drain up');
  const res = await stream;
  assert.equal(res.ended, true);
  assert.match(res.body, /"type":"config"/);

  // A stream that slips in while draining (on a connection already open) is ended too.
  let ended = false;
  drain.holdStream({ end: () => { ended = true; }, once: () => {} });
  assert.equal(ended, true);
});

test('while draining, an answer tells the client not to reuse its connection', async () => {
  const drain = createDrain();
  await drain.drain({ close: (cb) => cb && cb(), closeAllConnections() {} }, { timeoutMs: 10 });
  const headers = {};
  const res = { setHeader: (name, value) => { headers[name] = value; }, once: () => {} };
  let nexted = false;
  drain.track({}, res, () => { nexted = true; });
  assert.equal(nexted, true, 'the request is still answered');
  assert.equal(headers.Connection, 'close');
});
