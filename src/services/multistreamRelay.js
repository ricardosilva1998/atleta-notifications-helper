'use strict';

// Client for the control API of the multistream relay, a MediaMTX server (API
// v3, docs/multistream-relay-setup.md). OBS publishes to live/<stream key>; for
// each destination the website adds a path "fwd_<stream key>_<destination>"
// whose ffmpeg copies that stream to Twitch or YouTube (no re-encoding).
//
// Every function takes the relay settings (config.multistream: apiUrl,
// apiUser, apiToken and, optional, the Cloudflare Access service token) along
// with its own arguments. Each request logs in with HTTP Basic, the user
// MEDIAMTX_API_USER (admin when unset) and MEDIAMTX_API_TOKEN as its
// password; without a token nothing is sent. Each request has a timeout.

const REQUEST_TIMEOUT_MS = 10_000;
const DESTINATIONS = ['twitch', 'youtube'];
const LIST_PAGE_SIZE = 500;
const LIST_MAX_PAGES = 20;

// A stream key (db.ensureMultistreamToken), in the relay's path names.
const LIVE_PATH = /^live\/([A-Za-z0-9_-]{16,128})$/;
const FORWARDER_PATH = new RegExp(`^fwd_([A-Za-z0-9_-]{16,128})_(${DESTINATIONS.join('|')})$`);

// A forwarding address goes into ffmpeg's command line, which MediaMTX splits
// at spaces and quotes (expanding $variables), so only plain address
// characters are taken. Platform stream keys are letters, digits, '-', '_', '.'.
const SAFE_ADDRESS = /^rtmps?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._-]+)+$/;

function forwarderName(sourceToken, destination) {
  return `fwd_${sourceToken}_${destination}`;
}

function localSource(sourceToken) {
  return `rtmp://localhost/live/${sourceToken}`;
}

// -c copy: the bytes the streamer sent, unchanged; -f flv: the RTMP container.
// The input is the relay's own RTMP stream, so the command has no HTTP-only
// input options: with -reconnect* on an rtmp:// input ffmpeg refuses to start.
function buildFfmpegCmd(source, destUrl) {
  if (!SAFE_ADDRESS.test(source) || !SAFE_ADDRESS.test(destUrl)) {
    throw new Error('A forwarding address has unexpected characters');
  }
  return `ffmpeg -nostdin -loglevel warning -i ${source} -c copy -f flv ${destUrl}`;
}

function requestHeaders(settings) {
  if (!settings.apiToken) throw new Error('The relay API token (MEDIAMTX_API_TOKEN) is not set');
  const login = `${settings.apiUser || 'admin'}:${settings.apiToken}`;
  const headers = { Authorization: `Basic ${Buffer.from(login, 'utf8').toString('base64')}` };
  // A Cloudflare Access application in front of the relay's API hostname lets
  // this service token through (and nobody without it).
  if (settings.accessClientId && settings.accessClientSecret) {
    headers['CF-Access-Client-Id'] = settings.accessClientId;
    headers['CF-Access-Client-Secret'] = settings.accessClientSecret;
  }
  return headers;
}

function relayRequest(settings, method, apiPath, { body, signal } = {}) {
  if (!settings.apiUrl) throw new Error('The relay API address (MEDIAMTX_API_URL) is not set');
  const headers = requestHeaders(settings);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${settings.apiUrl.replace(/\/+$/, '')}${apiPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

// What the relay answered, for an error message: never a stream key (they are
// in the path names), which would let anyone who reads the log publish as the
// streamer. Without the key to cut out, only the status is kept.
async function failure(what, res, sourceToken) {
  const text = sourceToken ? await res.text().catch(() => '') : '';
  const detail = sourceToken ? text.split(sourceToken).join('<key>') : '';
  return new Error(`Relay ${what} failed: ${res.status} ${detail.slice(0, 200)}`.trim());
}

// Adds one forwarder per destination ({ name, url }); a destination without
// an address is skipped. Returns the names added. Throws on the first refusal.
async function addForwardPaths({ sourceToken, destinations, signal, ...settings }) {
  const source = localSource(sourceToken);
  const added = [];
  for (const dest of destinations) {
    if (!dest || !dest.url) continue;
    const res = await relayRequest(settings, 'POST', `/v3/config/paths/add/${forwarderName(sourceToken, dest.name)}`, {
      body: {
        source,
        sourceOnDemand: false,
        runOnAvailable: buildFfmpegCmd(source, dest.url),
        runOnAvailableRestart: true,
      },
      signal,
    });
    if (!res.ok) throw await failure(`add (${dest.name})`, res, sourceToken);
    added.push(dest.name);
  }
  return added;
}

// Removes these destinations' forwarders. One that is already gone is fine.
async function removeForwardPaths({ sourceToken, destinationNames, signal, ...settings }) {
  for (const name of destinationNames) {
    const res = await relayRequest(settings, 'DELETE', `/v3/config/paths/delete/${forwarderName(sourceToken, name)}`, { signal });
    if (!res.ok && res.status !== 404) throw await failure(`delete (${name})`, res, sourceToken);
  }
}

// The relay's view of live/<stream key>, or null when it has no such path.
async function getPathStats({ sourceToken, signal, ...settings }) {
  const res = await relayRequest(settings, 'GET', `/v3/paths/get/live/${sourceToken}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw await failure('stream lookup', res, sourceToken);
  return res.json();
}

// Whether that path has a stream coming in. MediaMTX 1.20 calls it
// "available"; earlier versions "ready".
function isLive(stats) {
  return !!stats && (stats.available === true || stats.ready === true);
}

// Every item of a paginated list.
async function listAll(settings, apiPath, signal) {
  const items = [];
  for (let page = 0; page < LIST_MAX_PAGES; page++) {
    const res = await relayRequest(settings, 'GET', `${apiPath}?itemsPerPage=${LIST_PAGE_SIZE}&page=${page}`, { signal });
    if (!res.ok) throw await failure(`list ${apiPath}`, res);
    const data = await res.json();
    if (Array.isArray(data.items)) items.push(...data.items);
    if (!(page + 1 < Number(data.pageCount))) break;
  }
  return items;
}

// The stream keys with a stream coming in to the relay right now (a Set).
async function listLiveStreams({ signal, ...settings }) {
  const keys = new Set();
  for (const item of await listAll(settings, '/v3/paths/list', signal)) {
    const match = LIVE_PATH.exec(item && item.name);
    if (match && isLive(item)) keys.add(match[1]);
  }
  return keys;
}

// The forwarders the relay has: a Map of stream key to the Set of its
// destinations ('twitch', 'youtube').
async function listForwarders({ signal, ...settings }) {
  const byKey = new Map();
  for (const item of await listAll(settings, '/v3/config/paths/list', signal)) {
    const match = FORWARDER_PATH.exec(item && item.name);
    if (!match) continue;
    if (!byKey.has(match[1])) byKey.set(match[1], new Set());
    byKey.get(match[1]).add(match[2]);
  }
  return byKey;
}

module.exports = {
  REQUEST_TIMEOUT_MS,
  DESTINATIONS,
  forwarderName,
  buildFfmpegCmd,
  addForwardPaths,
  removeForwardPaths,
  getPathStats,
  isLive,
  listLiveStreams,
  listForwarders,
};
