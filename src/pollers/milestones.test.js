'use strict';

// Milestone celebrations (L6): the first check of a channel records a starting
// point silently, instead of announcing "just hit 1,500 followers!" for a number
// the channel reached long ago. Pure functions; no Twitch, Discord or database.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { followerMilestone, subscriberMilestone, planMilestoneCheck } = require('./milestones');

// What the channel_milestones row holds before anything was recorded.
const UNSEEDED = { last_follower_count: 0, last_subscriber_count: 0, last_follower_milestone: 0, last_subscriber_milestone: 0 };

describe('which milestone a count has reached', () => {
  test('followers: every 100 under 1,000, every 500 under 10,000, every 1,000 above', () => {
    assert.equal(followerMilestone(0), 0);
    assert.equal(followerMilestone(99), 0);
    assert.equal(followerMilestone(100), 100);
    assert.equal(followerMilestone(999), 900);
    assert.equal(followerMilestone(1000), 1000);
    assert.equal(followerMilestone(1499), 1000);
    assert.equal(followerMilestone(1500), 1500);
    assert.equal(followerMilestone(9999), 9500);
    assert.equal(followerMilestone(10000), 10000);
    assert.equal(followerMilestone(10999), 10000);
    assert.equal(followerMilestone(25000), 25000);
  });

  test('subscribers: the fixed thresholds', () => {
    assert.equal(subscriberMilestone(0), 0);
    assert.equal(subscriberMilestone(9), 0);
    assert.equal(subscriberMilestone(10), 10);
    assert.equal(subscriberMilestone(24), 10);
    assert.equal(subscriberMilestone(25), 25);
    assert.equal(subscriberMilestone(999), 500);
    assert.equal(subscriberMilestone(10000), 10000);
    assert.equal(subscriberMilestone(50000), 10000);
  });
});

describe('planMilestoneCheck', () => {
  test('the first check of a channel records where it stands and announces nothing', () => {
    const followers = planMilestoneCheck('follower', 1500, UNSEEDED);
    assert.equal(followers.announce, null);
    assert.equal(followers.firstLook, true);
    assert.deepEqual(followers.update, { last_follower_count: 1500, last_follower_milestone: 1500 });

    const subscribers = planMilestoneCheck('subscriber', 60, UNSEEDED);
    assert.equal(subscribers.announce, null);
    assert.deepEqual(subscribers.update, { last_subscriber_count: 60, last_subscriber_milestone: 50 });
  });

  test('the first check of a small channel also announces nothing, and records its count', () => {
    const plan = planMilestoneCheck('follower', 42, UNSEEDED);
    assert.equal(plan.announce, null);
    assert.deepEqual(plan.update, { last_follower_count: 42, last_follower_milestone: 0 });
  });

  test('after that, crossing a milestone is announced and recorded', () => {
    const seeded = { ...UNSEEDED, last_follower_count: 1500, last_follower_milestone: 1500 };
    const plan = planMilestoneCheck('follower', 2000, seeded);
    assert.equal(plan.announce, 2000);
    assert.equal(plan.firstLook, false);
    assert.deepEqual(plan.update, { last_follower_count: 2000, last_follower_milestone: 2000 });
  });

  test('a channel that was seeded below its first milestone announces the first one it crosses', () => {
    const seeded = { ...UNSEEDED, last_follower_count: 42, last_follower_milestone: 0 };
    const plan = planMilestoneCheck('follower', 100, seeded);
    assert.equal(plan.announce, 100);
  });

  test('a jump over several milestones announces only the highest', () => {
    const seeded = { ...UNSEEDED, last_subscriber_count: 12, last_subscriber_milestone: 10 };
    const plan = planMilestoneCheck('subscriber', 130, seeded);
    assert.equal(plan.announce, 100);
    assert.deepEqual(plan.update, { last_subscriber_count: 130, last_subscriber_milestone: 100 });
  });

  test('between milestones only the count is stored', () => {
    const seeded = { ...UNSEEDED, last_follower_count: 1500, last_follower_milestone: 1500 };
    const plan = planMilestoneCheck('follower', 1700, seeded);
    assert.equal(plan.announce, null);
    assert.deepEqual(plan.update, { last_follower_count: 1700 });
  });

  test('a count that drops below a milestone and comes back does not announce it again', () => {
    let row = { ...UNSEEDED, last_follower_count: 1500, last_follower_milestone: 1500 };
    const dropped = planMilestoneCheck('follower', 1480, row);
    assert.equal(dropped.announce, null);
    assert.deepEqual(dropped.update, { last_follower_count: 1480 }, 'the milestone on record stays');

    row = { ...row, ...dropped.update };
    const back = planMilestoneCheck('follower', 1510, row);
    assert.equal(back.announce, null);
  });

  test('followers and subscribers are recorded separately', () => {
    const row = { ...UNSEEDED, last_follower_count: 1500, last_follower_milestone: 1500 };
    const plan = planMilestoneCheck('subscriber', 30, row);
    assert.equal(plan.announce, null, 'the subscriber side has not been seeded yet, whatever the follower side says');
    assert.deepEqual(plan.update, { last_subscriber_count: 30, last_subscriber_milestone: 25 });
  });

  test('a row with missing or text values behaves like an unseeded one', () => {
    for (const stored of [{}, { last_follower_count: null, last_follower_milestone: null }, { last_follower_count: '0', last_follower_milestone: '0' }]) {
      const plan = planMilestoneCheck('follower', 800, stored);
      assert.equal(plan.announce, null, JSON.stringify(stored));
      assert.equal(plan.update.last_follower_milestone, 800);
    }
  });
});
