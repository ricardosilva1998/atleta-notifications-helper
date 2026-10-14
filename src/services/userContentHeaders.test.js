'use strict';

// Serving headers for uploaded files (services/userContentHeaders.js): every
// file gets the sandbox CSP and nosniff; anything that is not an image, sound,
// video or model is also sent as an attachment. Real express.static over a
// temp folder, wired the way server.js wires its data/ routes.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { setUserContentHeaders, isInlineFile } = require('./userContentHeaders');

let dir;
let server;
let port;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atleta-files-'));
  fs.mkdirSync(path.join(dir, '5'));
  for (const name of ['shot.png', 'photo.JPG', 'clip.mp4', 'clip.webm', 'alert.mp3', 'model.vrm', 'page.html', 'drawing.svg', 'notes.txt', 'data.json', 'noext']) {
    fs.writeFileSync(path.join(dir, '5', name), 'synthetic');
  }
  const app = express();
  app.use('/files', express.static(dir, { setHeaders: (res, filePath) => setUserContentHeaders(res, filePath) }));
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath, agent: false }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    }).on('error', reject);
  });
}

describe('every uploaded file', () => {
  for (const name of ['shot.png', 'alert.mp3', 'page.html', 'noext']) {
    test(`${name} is sandboxed and keeps its declared type`, async () => {
      const res = await get(`/files/5/${name}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-security-policy'], "sandbox; default-src 'none'");
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
    });
  }
});

describe('Content-Disposition', () => {
  for (const name of ['shot.png', 'photo.JPG', 'clip.mp4', 'clip.webm', 'alert.mp3', 'model.vrm']) {
    test(`${name} (image, sound, video or model) is shown inline`, async () => {
      assert.equal((await get(`/files/5/${name}`)).headers['content-disposition'], undefined);
    });
  }
  for (const name of ['page.html', 'drawing.svg', 'notes.txt', 'data.json', 'noext']) {
    test(`${name} is downloaded, never shown as a page`, async () => {
      assert.equal((await get(`/files/5/${name}`)).headers['content-disposition'], 'attachment');
    });
  }
});

test('isInlineFile goes by the extension, whatever its case', () => {
  assert.equal(isInlineFile('/data/sounds/5/follow.mp3'), true);
  assert.equal(isInlineFile('/data/sponsors/5/sponsor_1.WEBP'), true);
  assert.equal(isInlineFile('/data/issues/9/shot_1.html'), false);
  assert.equal(isInlineFile('/data/issues/9/shot_1.png.html'), false);
  assert.equal(isInlineFile('/data/issues/9/png'), false);
});
