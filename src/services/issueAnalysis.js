'use strict';

// Rules for the AI analysis of a reported issue (services/agentTriage.js). Each
// analysis costs money, so an issue is analysed once, never twice at the same
// time, and a streamer can have only a few analysed a day.

// Analyses a streamer may start in any 24 hours.
const ANALYSES_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
// An analysis still marked 'analyzing' after this long died with a restart
// (the API call itself gives up well before), so the issue may be analysed again.
const ANALYSIS_STALE_MS = 15 * 60 * 1000;

// The status that stops a new analysis: 'analyzing' (one is running) or 'done'
// (it was analysed). null means the issue may be analysed, including after an 'error'.
function analysisBlockedReason(issue, now = Date.now()) {
  if (issue.agent_status === 'done') return 'done';
  if (issue.agent_status === 'analyzing') {
    const startedAt = Date.parse(issue.agent_analyzed_at);
    if (Number.isFinite(startedAt) && now - startedAt < ANALYSIS_STALE_MS) return 'analyzing';
  }
  return null;
}

// ISO time `ms` before `now`, the form db.js stores and compares.
const isoBefore = (now, ms) => new Date(now - ms).toISOString();
const dailyWindowStart = (now = Date.now()) => isoBefore(now, DAY_MS);
const staleBefore = (now = Date.now()) => isoBefore(now, ANALYSIS_STALE_MS);

module.exports = { ANALYSES_PER_DAY, ANALYSIS_STALE_MS, analysisBlockedReason, dailyWindowStart, staleBefore };
