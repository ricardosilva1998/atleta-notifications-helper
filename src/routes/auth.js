const { Router } = require('express');
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const { signLink, verifyLink, linkSecret, LINK_TTL_SECONDS } = require('../services/linkSignature');
const { issueOAuthState, checkOAuthState } = require('../services/oauthState');

const router = Router();

// How long a call to Twitch, Google or Spotify while connecting an account may take.
const OAUTH_TIMEOUT_MS = 10_000;

// --- Discord OAuth Login ---

router.get('/login', (req, res) => {
  const state = crypto.randomUUID();
  req.app.locals.secureCookie(res, 'oauth_state', state, { maxAge: 600_000 });

  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: `${config.app.url}/auth/login/callback`,
    response_type: 'code',
    scope: 'identify',
    state,
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

router.get('/login/callback', async (req, res) => {
  const { code, state } = req.query;
  const expectedState = req.cookies?.oauth_state;

  if (!code || !state || state !== expectedState) {
    return res.status(400).send('Invalid OAuth callback');
  }
  res.clearCookie('oauth_state');

  try {
    // Exchange code for token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.discord.clientId,
        client_secret: config.discord.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${config.app.url}/auth/login/callback`,
      }),
    });

    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const tokenData = await tokenRes.json();

    // Get Discord user identity
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) throw new Error('Failed to get user info');
    const user = await userRes.json();

    const avatar = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
      : null;

    // Create/update streamer record
    const streamer = db.upsertStreamerDiscord(
      user.id,
      user.username,
      user.global_name || user.username,
      avatar
    );

    // Create session
    const sid = crypto.randomUUID();
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    db.createSession(sid, streamer.id, expiresAt);
    req.app.locals.secureCookie(res, 'session', sid, { maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' });

    // Link Racing account if one is already logged in
    if (req.racingUser && !req.racingUser.streamer_id) {
      db.linkRacingUserToStreamer(req.racingUser.id, streamer.id);
      // Replace with a linked session
      db.deleteSession(sid);
      const linkedSid = crypto.randomBytes(32).toString('hex');
      db.createLinkedSession(linkedSid, streamer.id, req.racingUser.id, expiresAt);
      req.app.locals.secureCookie(res, 'session', linkedSid, { maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' });
      console.log(`[Auth] Discord login: ${user.username} (${user.id}) — linked to Racing user ${req.racingUser.id}`);
      return res.redirect('/racing/account?msg=' + encodeURIComponent('Discord account linked!'));
    }

    console.log(`[Auth] Discord login: ${user.username} (${user.id})`);
    res.redirect('/dashboard');
  } catch (error) {
    console.error(`[Auth] Discord login error: ${error.message}`);
    res.status(500).send('Login failed. Please try again.');
  }
});

// Logging out is a POST, sent by the logout forms (header.ejs, account.ejs,
// account-disabled.ejs) with the CSRF token. A GET changes nothing and goes
// home, so a link or an image elsewhere cannot log anyone out.
router.post('/logout', (req, res) => {
  const sid = req.cookies?.session;
  if (sid) db.deleteSession(sid);
  res.clearCookie('session');
  res.redirect('/');
});

router.get('/logout', (req, res) => res.redirect('/'));

// --- Twitch Account Linking ---

// The four connections below (Twitch, broadcaster, YouTube, Spotify) carry a
// random state that only this browser's cookie for that flow knows
// (services/oauthState.js), and attach what comes back to the streamer who is
// logged in, never to one named in the URL.

router.get('/twitch', (req, res) => {
  if (!req.streamer) return res.redirect('/auth/login');

  const params = new URLSearchParams({
    client_id: config.twitch.clientId,
    redirect_uri: `${config.app.url}/auth/twitch/callback`,
    response_type: 'code',
    scope: '',
    state: issueOAuthState(req, res, 'twitch'),
  });
  res.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
});

router.get('/twitch/callback', async (req, res) => {
  const stateOk = checkOAuthState(req, res, 'twitch');
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send('Missing parameters');
  if (!stateOk || !req.streamer) return res.status(403).send('Invalid state');
  const streamerId = req.streamer.id;

  try {
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: config.twitch.clientId,
        client_secret: config.twitch.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${config.app.url}/auth/twitch/callback`,
      }),
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });

    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const tokenData = await tokenRes.json();

    const userRes = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Client-Id': config.twitch.clientId,
      },
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });

    if (!userRes.ok) throw new Error('Failed to get Twitch user info');
    const userData = await userRes.json();
    const twitchUser = userData.data[0];

    db.linkTwitch(streamerId, twitchUser.id, twitchUser.login, twitchUser.display_name);
    console.log(`[Auth] Twitch linked: streamer ${streamerId} -> ${twitchUser.login}`);

    res.redirect('/dashboard?msg=twitch_linked');
  } catch (error) {
    console.error(`[Auth] Twitch link error: ${error.message}`);
    res.status(500).send('Twitch linking failed. Please try again.');
  }
});

// --- Broadcaster Auth (for sub sync) ---

// Who a Twitch user token belongs to and what it may do, as Twitch reports it:
// { user_id, login, scopes }. Throws when Twitch does not confirm the token.
async function validateTwitchToken(accessToken) {
  const res = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${accessToken}` },
    signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Token validation failed: ${res.status}`);
  const info = await res.json();
  if (!info || info.user_id == null || !Array.isArray(info.scopes)) {
    throw new Error('Token validation answered without a user or scopes');
  }
  return info;
}

router.get('/broadcaster', (req, res) => {
  if (!req.streamer) return res.redirect('/auth/login');

  const scopes = ['channel:read:subscriptions', 'moderator:read:followers', 'bits:read', 'channel:manage:redemptions'];
  // The stream key is read only to forward a multistream to Twitch, so it is
  // asked for only while the relay is configured (config.multistream.enabled).
  if (config.multistream.enabled) scopes.push('channel:read:stream_key');
  const params = new URLSearchParams({
    client_id: config.twitch.clientId,
    redirect_uri: `${config.app.url}/auth/broadcaster/callback`,
    response_type: 'code',
    scope: scopes.join(' '),
    state: issueOAuthState(req, res, 'broadcaster'),
  });
  res.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
});

router.get('/broadcaster/callback', async (req, res) => {
  const stateOk = checkOAuthState(req, res, 'broadcaster');
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send('Missing parameters');
  if (!stateOk || !req.streamer) return res.status(403).send('Invalid state');
  const streamer = req.streamer;

  try {
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: config.twitch.clientId,
        client_secret: config.twitch.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${config.app.url}/auth/broadcaster/callback`,
      }),
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });

    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const data = await tokenRes.json();

    // The token must be the linked channel's own. With another Twitch account's
    // token, Twitch answers for that account (no followers, no subscribers), so
    // !followage, the alerts and sub sync would go quietly wrong.
    const grant = await validateTwitchToken(data.access_token);
    if (!streamer.twitch_user_id || String(grant.user_id) !== String(streamer.twitch_user_id)) {
      console.warn(`[Auth] Broadcaster authorization refused for streamer ${streamer.id}: it was given by Twitch account ${grant.login || grant.user_id}, not the linked one (${streamer.twitch_username || 'none linked'})`);
      return res.redirect('/dashboard?msg=broadcaster_wrong_account');
    }

    db.updateStreamerBroadcasterTokens(
      streamer.id,
      data.access_token,
      data.refresh_token,
      Date.now() + data.expires_in * 1000 - 60_000
    );

    // The scopes Twitch granted, not the ones asked for.
    db.updateBroadcasterScopes(streamer.id, grant.scopes.join(' '));

    // Re-subscribe EventSub so the new scope's subscription type is picked up immediately.
    // startForStreamer is idempotent — it stops any running connection before reconnecting.
    try {
      const { eventSubManager } = require('../services/eventsub');
      eventSubManager.startForStreamer(streamer.id);
    } catch (e) {
      console.error('[Auth] EventSub restart after broadcaster auth failed:', e.message);
    }

    console.log(`[Auth] Broadcaster ${streamer.id} authorized for sub sync`);
    res.redirect('/dashboard?msg=broadcaster_authorized');
  } catch (error) {
    console.error(`[Auth] Broadcaster callback error: ${error.message}`);
    res.status(500).send('Authorization failed');
  }
});

// --- YouTube OAuth (streamer links their YouTube account) ---

router.get('/youtube', (req, res) => {
  if (!req.streamer) return res.redirect('/auth/login');
  const redirectUri = `${config.app.url}/auth/youtube/callback`;
  const params = new URLSearchParams({
    client_id: config.youtube.botClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/youtube',
    access_type: 'offline',
    prompt: 'consent',
    state: issueOAuthState(req, res, 'youtube'),
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/youtube/callback', async (req, res) => {
  const stateOk = checkOAuthState(req, res, 'youtube');
  const { code, error } = req.query;
  // The page shows only the codes it knows (YT_CHATBOT_ERRORS in dashboard.js), so
  // the URL carries a code: neither what Google sent nor our own error text.
  const back = (errorCode) => res.redirect(`/dashboard/youtube-chatbot?error=${errorCode}`);
  if (error) return back('oauth_denied');
  if (!code || !stateOk || !req.streamer) return back('oauth_state');
  const streamerId = req.streamer.id;

  try {
    const redirectUri = `${config.app.url}/auth/youtube/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.youtube.botClientId,
        client_secret: config.youtube.botClientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
    const tokenData = await tokenRes.json();

    // Get the user's YouTube channel info
    const channelRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
    let channelName = null;
    if (channelRes.ok) {
      const channelData = await channelRes.json();
      channelName = channelData.items?.[0]?.snippet?.title || null;
    }

    db.updateStreamerYoutubeTokens(
      streamerId,
      tokenData.access_token,
      tokenData.refresh_token,
      Date.now() + tokenData.expires_in * 1000 - 60_000,
      channelName
    );

    res.redirect('/dashboard/youtube-chatbot?connected_yt=1');
  } catch (err) {
    console.error('[Auth] YouTube OAuth error:', err.message);
    back('oauth_failed');
  }
});

// --- Spotify OAuth (streamer links their Spotify account) ---

router.get('/spotify', (req, res) => {
  if (!req.streamer) return res.redirect('/auth/login');
  const { clientId } = config.spotify;
  if (!clientId) return res.status(500).send('Spotify not configured');

  const redirectUri = `${config.app.url}/auth/spotify/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'user-read-currently-playing user-modify-playback-state',
    state: issueOAuthState(req, res, 'spotify'),
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

router.get('/spotify/callback', async (req, res) => {
  const stateOk = checkOAuthState(req, res, 'spotify');
  const { code, error } = req.query;
  if (error) return res.redirect('/dashboard?msg=spotify_error');
  if (!code || !stateOk || !req.streamer) return res.redirect('/dashboard?msg=spotify_error');
  const streamerId = req.streamer.id;

  try {
    const { clientId, clientSecret } = config.spotify;
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const redirectUri = `${config.app.url}/auth/spotify/callback`;

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });

    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
    const tokenData = await tokenRes.json();

    db.updateSpotifyTokens(
      streamerId,
      tokenData.access_token,
      tokenData.refresh_token,
      Date.now() + tokenData.expires_in * 1000 - 60000
    );

    res.redirect('/dashboard?msg=spotify_connected');
  } catch (err) {
    console.error('[Auth] Spotify OAuth error:', err.message);
    res.redirect('/dashboard?msg=spotify_error');
  }
});

// --- User Linking (community members link Twitch for sub sync) ---

// The /link URL is signed by the bot (src/services/linkSignature.js). Its
// Discord user then rides through the Twitch login in a cookie that is signed
// again, so neither the URL nor the cookie can be pointed at someone else.
const LINK_ROUND_TRIP_SECONDS = 600;

function refuseLink(res, reason) {
  console.warn(`[Auth] Refused a /link request: ${reason}`);
  return res.status(400).render('link-result', {
    success: false, expired: true, linkMinutes: Math.round(LINK_TTL_SECONDS / 60), twitchName: null, streamer: null,
  });
}

router.get('/link', (req, res) => {
  const link = verifyLink(req.query, linkSecret());
  if (!link.ok) return refuseLink(res, link.reason);

  const linkState = crypto.randomUUID();
  req.app.locals.secureCookie(res, 'link_state', linkState, { maxAge: LINK_ROUND_TRIP_SECONDS * 1000 });
  const roundTrip = signLink({ streamerId: link.streamerId, discordId: link.discordId, ttlSeconds: LINK_ROUND_TRIP_SECONDS }, linkSecret());
  req.app.locals.secureCookie(res, 'link_data', new URLSearchParams(roundTrip).toString(), { maxAge: LINK_ROUND_TRIP_SECONDS * 1000 });

  const params = new URLSearchParams({
    client_id: config.twitch.clientId,
    redirect_uri: `${config.app.url}/auth/link/callback`,
    response_type: 'code',
    scope: '',
    state: linkState,
    // Twitch always shows its consent screen, naming the account being linked:
    // a fresh /link URL passed to someone else's browser cannot link whichever
    // Twitch account that browser happens to be logged in to without them seeing it.
    force_verify: 'true',
  });
  res.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
});

router.get('/link/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).render('link-result', { success: false, twitchName: null, streamer: null });

  const expectedState = req.cookies?.link_state;
  const linkData = req.cookies?.link_data;
  res.clearCookie('link_state');
  res.clearCookie('link_data');
  // A missing cookie usually means the 10-minute round trip ran out.
  if (!expectedState || state !== expectedState || !linkData) return refuseLink(res, 'state or link cookie missing');

  const link = verifyLink(Object.fromEntries(new URLSearchParams(linkData)), linkSecret());
  if (!link.ok) return refuseLink(res, link.reason);
  const { streamerId, discordId } = link;

  try {
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: config.twitch.clientId,
        client_secret: config.twitch.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${config.app.url}/auth/link/callback`,
      }),
    });

    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const tokenData = await tokenRes.json();

    const userRes = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Client-Id': config.twitch.clientId,
      },
    });

    if (!userRes.ok) throw new Error('Failed to get user info');
    const userData = await userRes.json();
    const twitchUser = userData.data[0];

    db.linkUser(streamerId, discordId, twitchUser.id, twitchUser.login);
    console.log(`[Auth] Linked Discord ${discordId} -> Twitch ${twitchUser.login}`);

    res.render('link-result', { success: true, twitchName: twitchUser.display_name, streamer: null });
  } catch (error) {
    console.error(`[Auth] Link error: ${error.message}`);
    res.status(500).render('link-result', { success: false, twitchName: null, streamer: null });
  }
});

module.exports = router;
