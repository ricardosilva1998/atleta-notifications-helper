const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const RSSHUB_INSTANCES = ['https://rsshub.app', 'https://rsshub.rssforever.com', 'https://rsshub-instance.zeabur.app'];

async function resolveProfile(username) {
  // Strip @ if present
  const clean = username.replace(/^@/, '').trim().toLowerCase();
  try {
    const res = await fetch(`https://www.instagram.com/${clean}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Bot/1.0)' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const html = await res.text();
    const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || null;
    const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1]?.replace(/ \(@[^)]+\).*/, '').trim() || clean;
    return { username: clean, displayName: ogTitle, profileImageUrl: ogImage };
  } catch (e) {
    console.error(`[Instagram] Failed to resolve profile ${clean}: ${e.message}`);
    return null;
  }
}

async function getLatestPosts(username) {
  const clean = username.replace(/^@/, '').trim().toLowerCase();
  for (const instance of RSSHUB_INSTANCES) {
    try {
      const res = await fetch(`${instance}/instagram/user/${clean}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Bot/1.0)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const parsed = parser.parse(xml);
      const items = parsed.rss?.channel?.item;
      if (!items) continue;
      const entries = Array.isArray(items) ? items : [items];
      return entries.slice(0, 20).map(item => {
        const link = item.link || '';
        const id = link.match(/\/p\/([^/]+)/)?.[1] || link;
        const imageMatch = (item.description || '').match(/<img[^>]+src="([^"]+)"/);
        return {
          id,
          caption: (item.title || '').slice(0, 200),
          url: link,
          imageUrl: imageMatch?.[1] || null,
          timestamp: item.pubDate || null,
          author: username,
        };
      });
    } catch (e) {
      console.warn(`[Instagram] RSSHub instance ${instance} failed for ${clean}: ${e.message}`);
      continue;
    }
  }
  return null; // all instances failed
}

module.exports = { resolveProfile, getLatestPosts };
