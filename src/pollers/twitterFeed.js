const { getLatestTweets, checkAvailability } = require('../services/twitter');

async function check(twitterUsername, accountState) {
  const tweets = await getLatestTweets(twitterUsername);
  if (tweets === null) {
    // Service returned null — check availability and update flag
    const available = await checkAvailability();
    return { notify: false, stateUpdate: { available: available ? 1 : 0 } };
  }

  const knownIds = JSON.parse(accountState.known_tweet_ids || '[]');
  const newTweets = tweets.filter((t) => !knownIds.includes(t.id));
  const allIds = [...new Set([...knownIds, ...tweets.map((t) => t.id)])].slice(-50);

  if (newTweets.length === 0) {
    if (allIds.length !== knownIds.length) {
      return { notify: false, stateUpdate: { known_tweet_ids: JSON.stringify(allIds), available: 1 } };
    }
    return null;
  }

  return {
    notify: true,
    items: newTweets,
    stateUpdate: { known_tweet_ids: JSON.stringify(allIds), last_checked: new Date().toISOString(), available: 1 },
  };
}

module.exports = { check };
