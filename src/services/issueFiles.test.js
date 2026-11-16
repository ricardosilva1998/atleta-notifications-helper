'use strict';

// Issue screenshots: only the reporter or an admin reads one; everyone else
// (and a signed-out visitor) gets 404. The database is a stub.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');

const DB_FILE = path.join(__dirname, '..', 'db.js');
const ISSUES = path.join(__dirname, '..', '..', 'data', 'issues');
const ISSUE_ID = 987654;
const GOOD = 'shot_0123456789abcdef0123456789abcdef.png';

const issues = { [ISSUE_ID]: { id: ISSUE_ID, streamer_id: 1, screenshots: GOOD } };
const dbStub = { getIssueById: (id) => issues[id], isAdmin: (id) => id === 3 };

const realLoad = Module._load;
let server; let base; let who = null;

before(async () => {
  Module._load = function (request, parent, ...rest) {
    if (parent && /issueFiles\.js$/.test(parent.filename) && request === '../db') return dbStub;
    return realLoad.call(this, request, parent, ...rest);
  };
  const { issueFileHandler, issueFileHeaders } = require('./issueFiles');
  Module._load = realLoad;
  fs.mkdirSync(path.join(ISSUES, String(ISSUE_ID)), { recursive: true });
  fs.writeFileSync(path.join(ISSUES, String(ISSUE_ID), GOOD), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const app = express();
  app.use((req, res, next) => { req.streamer = who; next(); });
  app.get('/issues-files/:issueId/:file', issueFileHeaders, issueFileHandler);
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(path.join(ISSUES, String(ISSUE_ID)), { recursive: true, force: true });
});

const get = (p) => new Promise((resolve, reject) => {
  http.get(base + p, (res) => { res.resume(); res.on('end', () => resolve(res)); }).on('error', reject);
});

describe('issue screenshots', () => {
  test('a signed-out visitor gets 404', async () => {
    who = null;
    assert.equal((await get(`/issues-files/${ISSUE_ID}/${GOOD}`)).statusCode, 404);
  });
  test('another streamer gets 404', async () => {
    who = { id: 2 };
    assert.equal((await get(`/issues-files/${ISSUE_ID}/${GOOD}`)).statusCode, 404);
  });
  test('the reporter gets the file with the user-content headers', async () => {
    who = { id: 1 };
    const res = await get(`/issues-files/${ISSUE_ID}/${GOOD}`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.match(res.headers['content-security-policy'], /sandbox/);
  });
  test('an admin gets the file', async () => {
    who = { id: 3 };
    assert.equal((await get(`/issues-files/${ISSUE_ID}/${GOOD}`)).statusCode, 200);
  });
  test('a file the issue does not list, or a bad name, is 404', async () => {
    who = { id: 3 };
    assert.equal((await get(`/issues-files/${ISSUE_ID}/shot_other.png`)).statusCode, 404);
    assert.equal((await get(`/issues-files/${ISSUE_ID}/..%2F..%2Fbot.db`)).statusCode, 404);
    assert.equal((await get(`/issues-files/abc/${GOOD}`)).statusCode, 404);
  });
});
