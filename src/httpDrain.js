'use strict';

// Stopping the web server on SIGTERM/SIGINT (a deploy or a restart) without
// cutting off what it is in the middle of: no new connections are taken, the
// overlay event streams are ended (an OBS source reconnects by itself, to the
// new server), and the requests already being answered (a PayPal capture, an
// upload) get up to 10 seconds to finish. Whatever is still open then is closed.

function createDrain() {
  const inFlight = new Set(); // responses not finished yet, event streams included
  const streams = new Set(); // open event streams: they never finish on their own
  let draining = false;
  let onIdle = null;

  const settle = () => { if (onIdle && inFlight.size === 0) onIdle(); };

  // Middleware, registered first: counts a request until its response is done
  // or its connection is gone.
  function track(req, res, next) {
    inFlight.add(res);
    res.once('close', () => { inFlight.delete(res); settle(); });
    // A request that comes in on a kept-alive connection while draining is
    // still answered, but the connection is not kept for another one.
    if (draining) res.setHeader('Connection', 'close');
    next();
  }

  // Registers an event stream (text/event-stream) to end when the server stops.
  function holdStream(res) {
    if (draining) { res.end(); return; }
    streams.add(res);
    res.once('close', () => streams.delete(res));
  }

  // Stops `server` taking connections, ends the event streams and waits up to
  // timeoutMs for the requests in progress, then closes every connection left.
  // Resolves with the number of requests that had not finished (0 when all did).
  function drain(server, { timeoutMs = 10_000 } = {}) {
    draining = true;
    server.close(() => {}); // the callback only keeps a server that was not listening from throwing
    for (const res of streams) res.end();
    streams.clear();
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        onIdle = null;
        const unfinished = inFlight.size;
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        resolve(unfinished);
      };
      const timer = setTimeout(finish, timeoutMs);
      onIdle = finish;
      settle();
    });
  }

  return { track, holdStream, drain, inFlightCount: () => inFlight.size };
}

// The one the app uses (server.js tracks and drains, routes/overlay.js holds streams).
const shared = createDrain();

module.exports = {
  createDrain,
  track: shared.track,
  holdStream: shared.holdStream,
  drain: shared.drain,
  inFlightCount: shared.inFlightCount,
};
