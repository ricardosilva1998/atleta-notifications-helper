'use strict';
// The closest a session gets to OBS: the real site (src/server.js) on a fresh database, the real overlay page in
// headless Chromium at 1920x1080, alerts played through the overlay bus. Each look of the families named (default:
// every family but Samurai and Racing) plays in cyan, each family's bits look also in red, and the six alerts once
// untouched (no look). Writes one PNG per alert and shots.json; run from a throwaway copy of the repository.
// Usage: node obs-like-check.js <out dir> [family ...]
process.env.DISCORD_DISABLED = '1';
process.env.TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || 'x';
process.env.TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || 'x';
process.env.PORT = '3998';
process.env.APP_URL = 'http://127.0.0.1:3998';
const path = require('path');
const fs = require('fs');
const ROOT = process.cwd();
const [OUT, ...only] = process.argv.slice(2);
const { start, stop } = require(path.join(ROOT, 'src', 'server'));
const db = require(path.join(ROOT, 'src', 'db'));
const bus = require(path.join(ROOT, 'src', 'services', 'overlayBus'));
const styles = require(path.join(ROOT, 'src', 'services', 'alertStyles'));
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

const SAMPLE = {
  follow: { username: 'ApexAndre' }, subscription: { username: 'RacerDan', tier: '1', months: 4 },
  bits: { username: 'TurboTina', amount: 500 }, donation: { username: 'PitBoss92', amount: '25.00', currency: 'EUR', message: 'Box box!' },
  raid: { username: 'GridWalker', viewers: 42 }, giveaway_winner: { username: 'LuckyViewer42', prize: 'Season pass' },
};
const ALERTS = Object.keys(SAMPLE);
const FAMILIES = only.length ? only : styles.familyKeys().filter((key) => key !== 'samurai' && key !== 'racing');
const COLOURS = { cyan: '#29E0FF', red: '#E8202A' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  start();
  await sleep(500);
  const id = Number(db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username, overlay_token, overlay_enabled) VALUES (?, ?, ?, 1)')
    .run('300000000000000001', 'obscheck', 'tok-obs-check').lastInsertRowid);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|net::ERR|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto('http://127.0.0.1:3998/overlay/tok-obs-check?source=alerts', { waitUntil: 'load' });
  await sleep(800);
  const designs = () => Object.fromEntries(db.getAllOverlayDesigns(id).map((d) => [d.event_type, d]));
  const shots = [];
  async function play(type, label, waitMs) {
    bus.emit(`overlay:${id}`, { type: 'config-update', designs: designs() });
    await sleep(150);
    bus.emit(`overlay:${id}`, { type, data: { ...SAMPLE[type] } });
    await sleep(waitMs);   // the family's fonts (first time, at most 1.5 s) + the look's entrance + a margin
    const slot = await page.$('.alert-pos');
    const file = path.join(OUT, `${label}.png`);
    if (slot) await slot.screenshot({ path: file }); else fs.writeFileSync(file + '.missing', '');
    const info = await page.evaluate(() => { const s = document.querySelector('.alert-pos'); return s ? { cls: s.className, html: s.innerHTML.slice(0, 60) } : null; });
    shots.push({ label, file, info });
    bus.emit(`overlay:${id}`, { type: 'clear' });
    await sleep(300);
  }
  for (const type of ALERTS) {   // untouched: no look
    db.saveOverlayDesign(id, type, { card_position: 'mid-center' });
    await play(type, `untouched-${type}`, 3300);
  }
  for (const family of FAMILIES) {
    const map = styles.familyStyles(family);
    if (!map) { errors.push(`${family}: not a family of six looks`); continue; }
    for (const type of ALERTS) {
      const look = styles.lookOf(map[type]);
      const len = typeof look.len === 'function' ? look.len(Object.assign({ grows: true }, SAMPLE[type])) : look.len;
      const waitMs = 1500 + Math.round((Number(len) || 2) * 1000) + 600;
      for (const [name, hex] of Object.entries(COLOURS)) {
        if (name === 'red' && type !== 'bits') continue;
        db.setOverlayDesignStyle(id, type, map[type]);
        db.saveOverlayDesign(id, type, { card_position: 'mid-center', style_accent: hex });
        await play(type, `${map[type]}-${name}`, waitMs);
      }
    }
  }
  fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify({ shots, errors }, null, 1));
  console.log(JSON.stringify({ shots: shots.length, missing: shots.filter((s) => !s.info).map((s) => s.label), errors }));
  await browser.close();
  await stop({ timeoutMs: 1000 });
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
