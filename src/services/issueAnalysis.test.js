'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ANALYSES_PER_DAY, ANALYSIS_STALE_MS, analysisBlockedReason, dailyWindowStart, staleBefore } = require('./issueAnalysis');

const NOW = Date.parse('2026-10-13T12:00:00.000Z');
const minutesAgo = (minutes) => new Date(NOW - minutes * 60_000).toISOString();

describe('analysisBlockedReason', () => {
  test('an issue never analysed, or whose analysis failed, may be analysed', () => {
    assert.equal(analysisBlockedReason({ agent_status: null, agent_analyzed_at: null }, NOW), null);
    assert.equal(analysisBlockedReason({}, NOW), null);
    assert.equal(analysisBlockedReason({ agent_status: 'error', agent_analyzed_at: minutesAgo(1) }, NOW), null);
  });

  test('an issue that is done stays done', () => {
    assert.equal(analysisBlockedReason({ agent_status: 'done', agent_analyzed_at: minutesAgo(60 * 24 * 90) }, NOW), 'done');
    assert.equal(analysisBlockedReason({ agent_status: 'done', agent_analyzed_at: null }, NOW), 'done');
  });

  test('an issue being analysed is refused while the analysis can still be running', () => {
    assert.equal(analysisBlockedReason({ agent_status: 'analyzing', agent_analyzed_at: minutesAgo(0) }, NOW), 'analyzing');
    assert.equal(analysisBlockedReason({ agent_status: 'analyzing', agent_analyzed_at: minutesAgo(14) }, NOW), 'analyzing');
  });

  test('an analysis that began 15 minutes ago or more died with a restart, and the issue may be analysed again', () => {
    assert.equal(ANALYSIS_STALE_MS, 15 * 60_000);
    assert.equal(analysisBlockedReason({ agent_status: 'analyzing', agent_analyzed_at: minutesAgo(15) }, NOW), null);
    assert.equal(analysisBlockedReason({ agent_status: 'analyzing', agent_analyzed_at: minutesAgo(600) }, NOW), null);
  });

  test('an analysis with no readable start time counts as dead too', () => {
    assert.equal(analysisBlockedReason({ agent_status: 'analyzing', agent_analyzed_at: null }, NOW), null);
    assert.equal(analysisBlockedReason({ agent_status: 'analyzing', agent_analyzed_at: 'garbage' }, NOW), null);
  });
});

describe('the daily limit and the time windows', () => {
  test('five a day', () => {
    assert.equal(ANALYSES_PER_DAY, 5);
  });

  test('the day is the last 24 hours, in the ISO form the database stores', () => {
    assert.equal(dailyWindowStart(NOW), '2026-10-12T12:00:00.000Z');
    assert.equal(staleBefore(NOW), '2026-10-13T11:45:00.000Z');
    assert.ok(dailyWindowStart() < new Date().toISOString());
  });
});
