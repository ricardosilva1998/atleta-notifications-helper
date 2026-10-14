'use strict';

// How many alert overlays (the OBS browser source at /overlay/:token) are open per streamer right now, so
// the dashboard can say whether the overlay is open in OBS. routes/overlay.js counts only the streams that
// say they are the alert overlay (?source=alerts): the iRacing chat overlay reads the same stream.
const open = new Map(); // streamer id -> open streams

function opened(streamerId) {
  open.set(streamerId, (open.get(streamerId) || 0) + 1);
}

function closed(streamerId) {
  const left = (open.get(streamerId) || 0) - 1;
  if (left > 0) open.set(streamerId, left);
  else open.delete(streamerId);
}

function isOpen(streamerId) {
  return (open.get(streamerId) || 0) > 0;
}

module.exports = { opened, closed, isOpen };
