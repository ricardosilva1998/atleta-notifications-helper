// The one stream client of the OBS browser sources (alerts, sponsors, goal bars, trackers, poll bar, chat).
// connect({ url, onMessage, onOpen }) opens the stream and keeps it open: after an error it asks once whether the
// link still exists (a 404, a regenerated or removed link, waits 5 minutes; anything else the 5 s retry), then
// opens a new EventSource itself. It never leaves the reconnecting to the browser: EventSource gives up for good on
// a non-200 answer (a 502 while a deploy restarts), and an OBS source nobody watches would stay dead.
// A `config` message carrying another `serverVersion` than the first one (a deploy) reloads the page for its new script.
(function () {
  const RETRY_MS = 5000;
  const GONE_RETRY_MS = 300000;
  const PROBE_TIMEOUT_MS = 10000;

  function retryDelay(url) {
    if (typeof fetch !== 'function') return Promise.resolve(RETRY_MS);
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const deadline = ctl ? setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS) : null;
    return fetch(url, ctl ? { signal: ctl.signal, cache: 'no-store' } : { cache: 'no-store' })
      .then((r) => { if (deadline) clearTimeout(deadline); if (ctl) ctl.abort(); return r.status === 404 ? GONE_RETRY_MS : RETRY_MS; })
      .catch(() => { if (deadline) clearTimeout(deadline); return RETRY_MS; });
  }

  function connect(options) {
    const url = options.url;
    let source = null;
    let timer = null;
    let waiting = false;
    let stopped = false;
    let serverVersion = null;

    function open() {
      if (stopped) return;
      if (source) { source.close(); source = null; }
      const mine = new EventSource(url);
      source = mine;
      mine.onopen = () => { if (options.onOpen) options.onOpen(); };
      mine.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch (err) { return; }
        if (data && data.type === 'config' && data.serverVersion) {
          if (serverVersion && data.serverVersion !== serverVersion) {
            if (typeof location !== 'undefined') location.reload();
            return;
          }
          serverVersion = data.serverVersion;
        }
        options.onMessage(data);
      };
      mine.onerror = () => {
        mine.close();
        if (source === mine) source = null;
        if (stopped || waiting) return;
        waiting = true;
        retryDelay(url).then((ms) => {
          timer = setTimeout(() => { timer = null; waiting = false; open(); }, ms);
        });
      };
    }

    open();
    return {
      close() {
        stopped = true;
        if (timer) clearTimeout(timer);
        if (source) { source.close(); source = null; }
      },
    };
  }

  const api = { connect, retryDelay };
  if (typeof window !== 'undefined') window.AtletaSSE = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
