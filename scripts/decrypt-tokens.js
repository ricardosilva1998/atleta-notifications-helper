// EMERGENCY ROLLBACK ONLY, after TOKEN_ENCRYPTION_KEY was set: turns every
// enc:v1: token in streamers back into plain text, in place, with the key, so an
// older release (which can't read encrypted tokens) can be deployed. Run inside
// the running container, from /app, right before redeploying the older release:
//   TOKEN_ENCRYPTION_KEY=<the 64-hex key> node scripts/decrypt-tokens.js
// It prints how many values it decrypted. The columns match TOKEN_COLUMNS in
// src/db.js and the format matches src/services/secretBox.js.
const path = require('path');
const crypto = require('crypto');
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const key = Buffer.from(String(process.env.TOKEN_ENCRYPTION_KEY || '').trim(), 'hex');
if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be the 64-hex key');

const open = (value) => {
  const box = Buffer.from(value.slice('enc:v1:'.length), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, box.subarray(0, 12), { authTagLength: 16 });
  decipher.setAuthTag(box.subarray(12, 28));
  return Buffer.concat([decipher.update(box.subarray(28)), decipher.final()]).toString('utf8');
};

const columns = [
  'broadcaster_access_token', 'broadcaster_refresh_token',
  'yt_access_token', 'yt_refresh_token',
  'spotify_access_token', 'spotify_refresh_token',
  'bot_access_token', 'bot_refresh_token',
  'streamelements_jwt',
];
const db = new Database('data/bot.db');
db.pragma('busy_timeout = 5000');
let decrypted = 0;
db.transaction(() => {
  for (const row of db.prepare(`SELECT id, ${columns.join(', ')} FROM streamers`).all()) {
    for (const column of columns) {
      if (typeof row[column] === 'string' && row[column].startsWith('enc:v1:')) {
        db.prepare(`UPDATE streamers SET ${column} = ? WHERE id = ?`).run(open(row[column]), row.id);
        decrypted++;
      }
    }
  }
})();
console.log('decrypted', decrypted);
db.close();
