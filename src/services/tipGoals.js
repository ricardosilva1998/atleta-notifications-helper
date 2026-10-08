'use strict';

// Tip goals — one active donation goal per streamer, rendered as a progress bar
// in a dedicated OBS browser source (/overlay/goal/:token).
//
// Updates are pushed on their own bus channel (`tipgoal:<streamerId>`) instead of
// `overlay:<streamerId>` so the main alert overlay never sees (and queues) them.

const db = require('../db');
const bus = require('./overlayBus');

function channel(streamerId) {
  return `tipgoal:${streamerId}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Donations without a currency are assumed to be in the goal's currency.
function currencyMatches(goalCurrency, donationCurrency) {
  if (!donationCurrency) return true;
  return String(goalCurrency).toUpperCase() === String(donationCurrency).toUpperCase();
}

// Shape sent to the overlay — only what it needs to render.
function toPayload(goal) {
  if (!goal) return null;
  const target = Number(goal.target_amount) || 0;
  const current = Number(goal.current_amount) || 0;
  return {
    id: goal.id,
    title: goal.title,
    current: round2(current),
    target: round2(target),
    currency: goal.currency,
    barColor: goal.bar_color || '#22c55e',
    percent: target > 0 ? Math.min(100, round2((current / target) * 100)) : 0,
    completed: target > 0 && current >= target,
  };
}

// Push the current goal state (or `null` when there's no active goal) to every
// connected goal overlay for this streamer.
function broadcast(streamerId, extra) {
  const goal = db.getActiveTipGoal(streamerId);
  bus.emit(channel(streamerId), { type: 'tip_goal', goal: toPayload(goal), ...(extra || {}) });
}

// Called from every real donation source (PayPal tip page, StreamElements).
// Test alerts deliberately do not call this.
function recordDonation(streamerId, amount, currency) {
  try {
    const value = parseFloat(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    const goal = db.getActiveTipGoal(streamerId);
    if (!goal) return;
    if (!currencyMatches(goal.currency, currency)) {
      console.log(`[TipGoal] Skipped ${currency} ${value} for streamer ${streamerId} — goal is in ${goal.currency}`);
      return;
    }
    const result = db.addToTipGoal(goal.id, round2(value));
    if (!result) return;
    const justCompleted = !result.before.completed_at && !!result.after.completed_at;
    if (justCompleted) console.log(`[TipGoal] Goal "${goal.title}" reached for streamer ${streamerId}`);
    broadcast(streamerId, { added: round2(value), justCompleted });
  } catch (e) {
    console.error('[TipGoal] recordDonation error:', e.message);
  }
}

module.exports = { channel, toPayload, currencyMatches, broadcast, recordDonation };
