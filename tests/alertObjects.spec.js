// tests/alertObjects.spec.js
const { test, expect } = require('@playwright/test');

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const TOKEN = process.env.E2E_OVERLAY_TOKEN;

test.describe('alert objects on the real overlay', () => {
  test.skip(!TOKEN, 'set E2E_OVERLAY_TOKEN to run');

  test('registry loads and exposes the five objects', async ({ page }) => {
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${BASE}/overlay/${TOKEN}`);
    const keys = await page.evaluate(() => Object.keys(window.ATLETA_OBJECTS || {}));
    expect(keys.sort()).toEqual(['bits', 'donation', 'follow', 'raid', 'subscription']);
    expect(errors).toEqual([]);
  });

  test('every object renders without throwing', async ({ page }) => {
    await page.goto(`${BASE}/overlay/${TOKEN}`);
    const result = await page.evaluate(() => {
      const data = {
        follow: { username: 'ApexAndre' },
        subscription: { username: 'RacerDan', tier: '1', months: 4 },
        bits: { username: 'TurboTina', bits: 500 },
        donation: { username: 'PitBoss92', amount: '25.00', currency: 'EUR' },
        raid: { username: 'GridWalker', viewers: 42 },
      };
      const out = {};
      for (const k of Object.keys(window.ATLETA_OBJECTS)) {
        try { out[k] = window.ATLETA_OBJECTS[k].render(data[k]).length; }
        catch (e) { out[k] = 'THREW: ' + e.message; }
      }
      return out;
    });
    for (const [k, v] of Object.entries(result)) {
      expect(typeof v, `${k} must render to a string`).toBe('number');
      expect(v, `${k} must produce markup`).toBeGreaterThan(50);
    }
  });
});
