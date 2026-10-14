'use strict';

// Follower and subscriber milestones: which milestone a count has reached, and
// what a check should announce and store. Pure, so it can be tested without
// Twitch, Discord or the database.

// Under 1,000 followers every 100, then every 500 up to 10,000, then every 1,000.
function followerMilestone(count) {
  if (count < 1000) return Math.floor(count / 100) * 100;
  if (count < 10000) return Math.floor(count / 500) * 500;
  return Math.floor(count / 1000) * 1000;
}

const SUBSCRIBER_MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

function subscriberMilestone(count) {
  let milestone = 0;
  for (const m of SUBSCRIBER_MILESTONES) {
    if (count >= m) milestone = m;
    else break;
  }
  return milestone;
}

// What a check of one count should do. `kind` is 'follower' or 'subscriber';
// `stored` is the channel_milestones row (it holds zeros before the first check).
// Returns { announce, update, firstLook }: the milestone to announce (or null),
// the columns to store, and whether this was the first look at the channel.
//
// The first look at a channel only records where it stands. Announcing then
// would say "just hit 1,500 followers!" about a number the channel reached long
// ago. Only a milestone above the highest one already recorded is announced, so
// a count that drops below a milestone and returns does not announce it again.
// (A row of zeros is the first look; a channel that goes from nothing to a
// milestone within one check is recorded, not announced.)
function planMilestoneCheck(kind, count, stored) {
  const countColumn = `last_${kind}_count`;
  const milestoneColumn = `last_${kind}_milestone`;
  const milestone = kind === 'follower' ? followerMilestone(count) : subscriberMilestone(count);
  const recorded = Number(stored[milestoneColumn]) || 0;
  const seeded = recorded > 0 || (Number(stored[countColumn]) || 0) > 0;

  if (!seeded) {
    return { announce: null, update: { [countColumn]: count, [milestoneColumn]: milestone }, firstLook: true };
  }
  if (milestone > recorded) {
    return { announce: milestone, update: { [countColumn]: count, [milestoneColumn]: milestone }, firstLook: false };
  }
  return { announce: null, update: { [countColumn]: count }, firstLook: false };
}

module.exports = { followerMilestone, subscriberMilestone, planMilestoneCheck, SUBSCRIBER_MILESTONES };
