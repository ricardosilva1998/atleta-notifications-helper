// MediaMTX HTTP control API client.
// Used by the on-ready / on-not-ready webhooks to add/remove ffmpeg forwarder
// paths that fan a single RTMP stream out to multiple platforms.

function buildFfmpegCmd(localSource, destUrl) {
  // -c copy = passthrough (no re-encode). Same bytes streamer sent us go to platform.
  // -f flv  = RTMP container.
  // -reconnect 1 ... = recover from transient socket flaps without restarting.
  return `ffmpeg -nostdin -loglevel warning -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -i ${localSource} -c copy -f flv ${destUrl}`;
}

async function addForwardPaths({ apiUrl, apiToken, sourceToken, destinations }) {
  const localSource = `rtmp://localhost/live/${sourceToken}`;
  const added = [];
  for (const dest of destinations) {
    if (!dest || !dest.url) continue;
    const pathName = `fwd_${sourceToken}_${dest.name}`;
    const url = `${apiUrl.replace(/\/$/, '')}/v3/config/paths/add/${pathName}`;
    const body = {
      source: localSource,
      sourceOnDemand: false,
      runOnReady: buildFfmpegCmd(localSource, dest.url),
      runOnReadyRestart: true,
    };
    const headers = { 'Content-Type': 'application/json' };
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`MediaMTX add ${pathName} failed: ${res.status} ${text}`);
    }
    added.push(dest.name);
  }
  return added;
}

async function removeForwardPaths({ apiUrl, apiToken, sourceToken, destinationNames }) {
  for (const name of destinationNames) {
    const pathName = `fwd_${sourceToken}_${name}`;
    const url = `${apiUrl.replace(/\/$/, '')}/v3/config/paths/delete/${pathName}`;
    const headers = {};
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;
    const res = await fetch(url, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new Error(`MediaMTX delete ${pathName} failed: ${res.status} ${text}`);
    }
  }
}

async function getPathStats({ apiUrl, apiToken, sourceToken }) {
  const url = `${apiUrl.replace(/\/$/, '')}/v3/paths/get/live/${sourceToken}`;
  const headers = {};
  if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;
  const res = await fetch(url, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`MediaMTX stats ${sourceToken} failed: ${res.status}`);
  return res.json();
}

module.exports = { addForwardPaths, removeForwardPaths, getPathStats };
