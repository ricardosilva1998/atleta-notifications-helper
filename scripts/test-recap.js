// Test script: Force a stream recap for andre_vilela_
// Run with: railway run -- node scripts/test-recap.js

const db = require('../src/db');
const { getStream, getClips, getUserId } = require('../src/services/twitch');
const { getVideos } = require('../src/services/twitch');
const { buildRecapEmbed, sendNotification } = require('../src/discord');
const { client } = require('../src/discord');
const config = require('../src/config');

async function testRecap() {
  const username = 'andre_vilela_';

  console.log('=== Test Recap for', username, '===\n');

  // Get broadcaster ID
  let broadcasterId = null;
  const state = db.getChannelState(username);
  broadcasterId = state?.twitch_broadcaster_id;

  if (!broadcasterId) {
    console.log('No broadcaster ID cached, fetching...');
    broadcasterId = await getUserId(username);
    if (broadcasterId) {
      db.updateChannelState(username, { twitch_broadcaster_id: broadcasterId });
      console.log('Broadcaster ID:', broadcasterId);
    } else {
      console.log('ERROR: Could not find Twitch user');
      process.exit(1);
    }
  } else {
    console.log('Broadcaster ID:', broadcasterId);
  }

  // Fetch recent clips (last 24 hours)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let clips = [];
  try {
    const allClips = await getClips(broadcasterId, since);
    clips = allClips.sort((a, b) => b.view_count - a.view_count).slice(0, 3);
    console.log('Clips found:', allClips.length, '(showing top', clips.length, ')');
    clips.forEach(c => console.log('  -', c.title, '(' + c.view_count + ' views)'));
  } catch (e) {
    console.log('Clips fetch error:', e.message);
  }

  // Build recap data (simulate a 2-hour stream)
  const recapData = {
    twitchUsername: username,
    title: 'Test Stream Recap',
    category: 'Just Chatting',
    thumbnailUrl: null,
    duration: 7200, // 2 hours
    clips,
  };

  console.log('\nRecap data:');
  console.log('  Title:', recapData.title);
  console.log('  Category:', recapData.category);
  console.log('  Duration:', Math.floor(recapData.duration / 60), 'min');
  console.log('  Clips:', recapData.clips.length);

  // Build the embed
  const embed = buildRecapEmbed(recapData);
  console.log('\nEmbed built successfully');
  console.log('  Color:', embed.data.color);
  console.log('  Title:', embed.data.title);
  console.log('  Fields:', embed.data.fields?.length || 0);

  // Find watchers
  const watchers = db.getWatchersForChannel(username).filter(w => w.live_channel_id);
  console.log('\nWatchers with live_channel_id:', watchers.length);

  if (watchers.length === 0) {
    console.log('No watchers found — cannot send. Showing embed data instead:');
    console.log(JSON.stringify(embed.data, null, 2));
    process.exit(0);
  }

  // Wait for Discord client to be ready
  console.log('\nWaiting for Discord client...');

  client.once('ready', async () => {
    console.log('Discord client ready');

    for (const w of watchers) {
      try {
        console.log(`Sending recap to guild ${w.guild_id}, channel ${w.live_channel_id}...`);
        await sendNotification(w.live_channel_id, embed, {
          streamerId: w.streamer_id,
          guildId: w.guild_id,
          type: 'twitch_recap',
        });
        console.log('Recap sent successfully!');
      } catch (e) {
        console.error('Send failed:', e.message);
      }
    }

    console.log('\nDone!');
    process.exit(0);
  });

  client.login(config.discord.token);
}

testRecap().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
