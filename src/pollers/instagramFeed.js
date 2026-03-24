const { getLatestPosts } = require('../services/instagram');

async function check(instagramUsername, accountState) {
  const posts = await getLatestPosts(instagramUsername);
  if (posts === null) return null; // service unavailable

  const knownIds = JSON.parse(accountState.known_post_ids || '[]');
  const newPosts = posts.filter((p) => !knownIds.includes(p.id));
  const allIds = [...new Set([...knownIds, ...posts.map((p) => p.id)])].slice(-50);

  if (newPosts.length === 0) {
    if (allIds.length !== knownIds.length) {
      return { notify: false, stateUpdate: { known_post_ids: JSON.stringify(allIds) } };
    }
    return null;
  }

  return {
    notify: true,
    items: newPosts,
    stateUpdate: { known_post_ids: JSON.stringify(allIds), last_checked: new Date().toISOString() },
  };
}

module.exports = { check };
