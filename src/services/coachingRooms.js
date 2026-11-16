'use strict';

// The private Discord room of a confirmed coaching session (planning decision 10). A placeholder until the rooms are
// built: makeFor() is the hook coachingBookings.js calls once a booking is confirmed (paid, or a free length accepted),
// and it makes nothing yet. Its contract: never throws, resolves to { url } (the room's https://discord.com/channels/...
// link, which the confirmation message carries) or null when there is no room.

async function makeFor(_bookingId) {
  return null;
}

module.exports = { makeFor };
