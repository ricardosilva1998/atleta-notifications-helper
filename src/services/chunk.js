'use strict';

// Splits a list into consecutive slices of at most `size` items; the last one
// may be shorter. Twitch takes 100 logins and YouTube 50 video ids per request,
// so a longer list is sent as several requests.
function chunk(items, size) {
  const length = Math.floor(size);
  if (!Number.isFinite(length) || length < 1) throw new RangeError('chunk size must be a number of at least 1');
  const slices = [];
  for (let i = 0; i < items.length; i += length) slices.push(items.slice(i, i + length));
  return slices;
}

module.exports = { chunk };
