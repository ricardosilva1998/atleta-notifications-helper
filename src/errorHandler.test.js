'use strict';

// The app-level error handler on a small real Express app: what a visitor sees
// (never a stack) and what reaches the server log.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const express = require('express');

const { errorHandler } = require('./errorHandler');
const { t } = require('./i18n');

let server;
let port;
const logged = [];
const saved = {};

function request(method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, agent: false, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      // A response cut off mid-way (the server destroys the socket) never ends.
      res.on('error', reject);
      res.on('close', () => { if (!res.complete) reject(new Error('response cut off')); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

before(async () => {
  saved.error = console.error;
  saved.warn = console.warn;
  console.error = (...args) => logged.push(['error', args.join(' ')]);
  console.warn = (...args) => logged.push(['warn', args.join(' ')]);

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.json());
  app.use((req, res, next) => {
    if (!req.path.startsWith('/no-t')) res.locals.t = (key, params) => t('en', key, params);
    next();
  });
  app.get('/boom', () => { throw new Error('secret internal detail'); });
  app.get('/no-t/boom', () => { throw new Error('before the language middleware'); });
  app.get('/async-boom', async () => { throw new Error('rejected after await'); });
  app.get('/api/boom', () => { throw new Error('api failure'); });
  app.post('/echo', (req, res) => res.json(req.body));
  app.get('/started', (req, res, next) => {
    res.write('partial');
    next(new Error('failed mid-response'));
  });
  app.get('/teapot', (req, res, next) => next(Object.assign(new Error('nope'), { status: 418 })));
  app.get('/five-hundred-and-three', (req, res, next) => next(Object.assign(new Error('upstream down'), { status: 503 })));
  app.use(errorHandler);

  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  console.error = saved.error;
  console.warn = saved.warn;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => { logged.length = 0; });

describe('errorHandler: pages', () => {
  test('a route that throws gets a generic page without the message or a stack', async () => {
    const res = await request('GET', '/boom');
    assert.equal(res.status, 500);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.text, /Something went wrong/);
    assert.doesNotMatch(res.text, /secret internal detail/);
    assert.doesNotMatch(res.text, /errorHandler\.test|node_modules|\.js:\d+/);
  });

  test('an async route that rejects is handled the same way', async () => {
    const res = await request('GET', '/async-boom');
    assert.equal(res.status, 500);
    assert.match(res.text, /Something went wrong/);
    assert.doesNotMatch(res.text, /rejected after await/);
  });

  test('the stack goes to the server log, not to the visitor', async () => {
    await request('GET', '/boom');
    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], 'error');
    assert.match(logged[0][1], /\[Error\] GET \/boom -> 500/);
    assert.match(logged[0][1], /secret internal detail/);
  });

  test('still answers when the language middleware has not run', async () => {
    const res = await request('GET', '/no-t/boom');
    assert.equal(res.status, 500);
    assert.match(res.text, /Something went wrong/);
  });
});

describe('errorHandler: JSON', () => {
  test('an /api route gets { error: "Internal error" }', async () => {
    const res = await request('GET', '/api/boom');
    assert.equal(res.status, 500);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.deepEqual(JSON.parse(res.text), { error: 'Internal error' });
  });

  test('a request that asks for JSON gets JSON', async () => {
    const res = await request('GET', '/boom', { headers: { Accept: 'application/json' } });
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(res.text), { error: 'Internal error' });
  });

  test('a request that sent JSON, or XHR, gets JSON', async () => {
    const sentJson = await request('GET', '/boom', { headers: { 'Content-Type': 'application/json', 'Content-Length': '2' }, body: '{}' });
    assert.deepEqual(JSON.parse(sentJson.text), { error: 'Internal error' });
    const xhr = await request('GET', '/boom', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    assert.deepEqual(JSON.parse(xhr.text), { error: 'Internal error' });
  });

  test('a raw upload that fails gets JSON, because the page reads a JSON answer', async () => {
    const res = await request('GET', '/boom', { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '3' }, body: 'abc' });
    assert.deepEqual(JSON.parse(res.text), { error: 'Internal error' });
  });
});

describe('errorHandler: client errors keep their status', () => {
  test('malformed JSON in a body is a 400, not a 500', async () => {
    const res = await request('POST', '/echo', {
      headers: { 'Content-Type': 'application/json', 'Content-Length': '8' }, body: '{"a": 1x',
    });
    assert.equal(res.status, 400);
    assert.deepEqual(JSON.parse(res.text), { error: 'Bad Request' });
    assert.equal(logged[0][0], 'warn');
    assert.doesNotMatch(res.text, /Unexpected token|SyntaxError/);
  });

  test('an HTML request with a 4xx error shows the generic page with that status', async () => {
    const res = await request('GET', '/teapot');
    assert.equal(res.status, 418);
    assert.match(res.text, /Something went wrong/);
  });

  test('a 5xx status other than 500 is answered as 500 (no upstream detail leaks)', async () => {
    const res = await request('GET', '/five-hundred-and-three', { headers: { Accept: 'application/json' } });
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(res.text), { error: 'Internal error' });
  });
});

describe('errorHandler: a response that has already started', () => {
  test('is left to Express, which closes the connection', async () => {
    await assert.rejects(request('GET', '/started'));
  });
});
