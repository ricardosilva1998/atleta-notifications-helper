'use strict';

// Which model the AI issue analysis asks for, and that it can be changed from the
// environment. The Anthropic SDK, db and the disk are stubs: no request is made.

const { test, describe, beforeEach, afterEach, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const requests = []; // what the fake client was asked
const requestOptions = []; // the per-request options it was given with each
const saved = []; // what was stored for the issue
let reply;

class FakeAnthropic {
  constructor(options) { this.options = options; }
  get messages() {
    return { create: async (params, options) => { requests.push(params); requestOptions.push(options); return reply; } };
  }
}

const issue = { id: 7, subject: 'Overlay is blank', description: 'It shows nothing in OBS', discord_username: 'streamer', screenshots: null };
const dbStub = {
  getIssueById: (id) => (id === 7 ? issue : null),
  updateIssueAgentStatus: (id, status) => saved.push(['status', id, status]),
  updateIssueAnalysis: (id, analysis, status) => saved.push(['analysis', id, status, JSON.parse(analysis)]),
};
const configStub = { anthropic: { apiKey: 'test-key', triageModel: 'claude-sonnet-5-5' } };
const noDiskFs = { existsSync: () => false, readFileSync: () => '', readdirSync: () => [] };

const origLoad = Module._load;
const realLog = console.log;
let agentTriage;

before(() => {
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename && parent.filename.endsWith(`${path.sep}agentTriage.js`)) {
      if (request === '@anthropic-ai/sdk') return { default: FakeAnthropic };
      if (request === '../config') return configStub;
      if (request === '../db') return dbStub;
      if (request === 'fs') return noDiskFs;
    }
    return origLoad.call(this, request, parent, isMain);
  };
  agentTriage = require('./agentTriage');
});
after(() => { Module._load = origLoad; });

beforeEach(() => {
  requests.length = 0;
  requestOptions.length = 0;
  saved.length = 0;
  reply = { content: [{ type: 'text', text: JSON.stringify({ summary: 'The overlay URL is wrong', root_cause: 'x', can_fix: false, confidence: 'low', patch: [], notes: '' }) }] };
  console.log = () => {};
});
afterEach(() => {
  console.log = realLog;
  configStub.anthropic.triageModel = 'claude-sonnet-5-5';
});

describe('the model of the AI issue analysis', () => {
  test('is the one in the configuration, claude-sonnet-5-5 by default', async () => {
    const analysis = await agentTriage.analyzeIssue(7);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, 'claude-sonnet-5-5');
    assert.equal(analysis.summary, 'The overlay URL is wrong');
    assert.deepEqual(saved.map((s) => s.slice(0, 3)), [['status', 7, 'analyzing'], ['analysis', 7, 'done']]);
  });

  test('follows a change of the configured model', async () => {
    configStub.anthropic.triageModel = 'some-other-model';
    await agentTriage.analyzeIssue(7);
    assert.equal(requests[0].model, 'some-other-model');
  });

  test('the old, invalid model id is gone', async () => {
    await agentTriage.analyzeIssue(7);
    assert.notEqual(requests[0].model, 'claude-sonnet-4-6-20250514');
  });

  test('an unknown issue is an error and asks the model nothing', async () => {
    await assert.rejects(() => agentTriage.analyzeIssue(99), /Issue not found/);
    assert.equal(requests.length, 0);
  });
});

describe('how long an analysis can take', () => {
  test('the request is cut off after 2 minutes and retried once, well inside the 15-minute stale window', async () => {
    const { ANALYSIS_STALE_MS } = require('./issueAnalysis');
    await agentTriage.analyzeIssue(7);
    assert.deepEqual(requestOptions, [{ timeout: 120000, maxRetries: 1 }]);
    const worstCase = requestOptions[0].timeout * (requestOptions[0].maxRetries + 1);
    assert.ok(worstCase < ANALYSIS_STALE_MS, `${worstCase} ms of waiting must end before ${ANALYSIS_STALE_MS} ms`);
  });
});

describe('TRIAGE_MODEL in the environment', () => {
  const REQUIRED = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'];
  const originals = {};

  // config.js reads the environment when it loads.
  function loadConfig(triageModel) {
    for (const key of REQUIRED) process.env[key] = process.env[key] || 'test';
    if (triageModel === undefined) delete process.env.TRIAGE_MODEL; else process.env.TRIAGE_MODEL = triageModel;
    const file = require.resolve('../config');
    delete require.cache[file];
    return require(file);
  }

  beforeEach(() => {
    for (const key of [...REQUIRED, 'TRIAGE_MODEL']) originals[key] = process.env[key];
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    delete require.cache[require.resolve('../config')];
  });

  test('is claude-sonnet-5-5 when it is not set', () => {
    assert.equal(loadConfig(undefined).anthropic.triageModel, 'claude-sonnet-5-5');
  });

  test('replaces it when it is set', () => {
    assert.equal(loadConfig('claude-opus-5').anthropic.triageModel, 'claude-opus-5');
  });

  test('an empty value means the default', () => {
    assert.equal(loadConfig('').anthropic.triageModel, 'claude-sonnet-5-5');
  });

  test('the configuration no longer has GitHub settings (auto-fix is gone)', () => {
    assert.equal('github' in loadConfig(undefined), false);
  });
});
