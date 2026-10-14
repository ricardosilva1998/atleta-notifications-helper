'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const OBJECTS = require('../public/overlay/objects/index.js');

const KEYS = ['follow', 'subscription', 'bits', 'donation', 'raid'];

describe('object registry contract', () => {
  test('exports exactly the five Twitch event types', () => {
    assert.deepEqual(Object.keys(OBJECTS).sort(), [...KEYS].sort());
  });

  test('every object has a render function and timing metadata', () => {
    for (const k of KEYS) {
      const o = OBJECTS[k];
      assert.equal(o.key, k, `${k}: key must match its registry slot`);
      assert.equal(typeof o.render, 'function', `${k}: render must be a function`);
      for (const phase of ['anim', 'exit']) {
        assert.ok(o[phase], `${k}: missing ${phase}`);
        assert.match(o[phase].dur, /^\d+(\.\d+)?s$/, `${k}: ${phase}.dur must be like "0.40s"`);
        assert.equal(typeof o[phase].ease, 'string', `${k}: ${phase}.ease must be a string`);
      }
      assert.equal(typeof o.anim.in, 'string', `${k}: anim.in must name a keyframe`);
      assert.equal(typeof o.exit.out, 'string', `${k}: exit.out must name a keyframe`);
    }
  });
});

const fs = require('node:fs');
const path = require('node:path');

describe('objects.css integrity', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'overlay', 'objects', 'objects.css'), 'utf8');
  const defined = new Set([...css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map(m => m[1]));

  test('every keyframe named by the registry exists in objects.css', () => {
    const missing = [];
    for (const k of KEYS) {
      if (!defined.has(OBJECTS[k].anim.in)) missing.push(`${k}.anim.in=${OBJECTS[k].anim.in}`);
      if (!defined.has(OBJECTS[k].exit.out)) missing.push(`${k}.exit.out=${OBJECTS[k].exit.out}`);
    }
    assert.deepEqual(missing, [], 'keyframes referenced but not defined');
  });

  test('defines the shared positioning wrapper and blade', () => {
    assert.match(css, /\.alert-pos\s*\{/, '.alert-pos must exist — centering lives here, not in keyframes');
    assert.match(css, /\.o-blade\s*\{/, '.o-blade must exist — shared cut flash');
  });

  test('no object-internal class escapes its .o- prefix', () => {
    // Guards the collision that pinned the byobu frame rail to the wrong edge.
    const generic = ['.rail{', '.rail {', '.panel{', '.panel {', '.seal{', '.seal {'];
    for (const g of generic) {
      assert.ok(!css.includes(g), `bare generic selector "${g.trim()}" will collide on the builder page`);
    }
  });
});

describe('follow — iaido band', () => {
  test('renders the username and escapes HTML', () => {
    const html = OBJECTS.follow.render({ username: '<img src=x>Ap&x' });
    assert.ok(html.includes('&lt;img src=x&gt;Ap&amp;x'), 'must escape user input');
    assert.ok(!html.includes('<img src=x>'), 'must not emit raw user HTML');
  });

  test('includes the blade and scar elements the animation drives', () => {
    const html = OBJECTS.follow.render({ username: 'ApexAndre' });
    assert.match(html, /class="o-blade"/);
    assert.match(html, /class="o-follow-scar"/);
    assert.match(html, /class="obj o-follow"/);
  });
});

describe('subscription — torii gate', () => {
  test('puts the text inside the gaku plaque, not loose on the gate', () => {
    const html = OBJECTS.subscription.render({ username: 'RacerDan', tier: '1', months: 4 });
    const gakuAt = html.indexOf('o-sub-gaku');
    const nameAt = html.indexOf('RacerDan');
    assert.ok(gakuAt > -1, 'gaku plaque must exist — it is the legibility fix');
    assert.ok(nameAt > gakuAt, 'username must render inside the gaku');
  });

  test('renders tier and months when supplied', () => {
    const html = OBJECTS.subscription.render({ username: 'RacerDan', tier: '1', months: 4 });
    assert.match(html, /Tier 1/);
    assert.match(html, /4 months/);
  });

  test('omits the months clause when months is absent', () => {
    const html = OBJECTS.subscription.render({ username: 'RacerDan', tier: '1' });
    assert.ok(!html.includes('months'), 'no months data means no months text');
  });

  test('surfaces the message (e.g. a gift bomb) when present, escaped', () => {
    const html = OBJECTS.subscription.render({
      username: 'GiftKing', tier: '1', message: '<b>Gifted 5 subs!</b>',
    });
    assert.match(html, /class="o-sub-msg"/);
    assert.ok(html.includes('&lt;b&gt;Gifted 5 subs!&lt;/b&gt;'), 'must escape the message');
    assert.ok(!html.includes('<b>Gifted 5 subs!</b>'), 'must not emit raw user HTML');
  });

  test('omits the message element when message is absent', () => {
    const html = OBJECTS.subscription.render({ username: 'RacerDan', tier: '1', months: 4 });
    assert.ok(!html.includes('o-sub-msg'), 'no message data means no message element');
  });
});

describe('bits — tally board', () => {
  // Shape matches the real producers (src/services/eventsub.js channel.cheer
  // and the dashboard.js test route): {username, amount, message}.
  test('emits one tile per digit, in order', () => {
    const html = OBJECTS.bits.render({ username: 'TurboTina', amount: 500, message: 'cheer!' });
    const tiles = [...html.matchAll(/class="o-bits-tile"[^>]*>(\d)</g)].map(m => m[1]);
    assert.deepEqual(tiles, ['5', '0', '0']);
  });

  test('staggers each tile so they flip left to right', () => {
    const html = OBJECTS.bits.render({ username: 'TurboTina', amount: 500, message: 'cheer!' });
    const delays = [...html.matchAll(/--rdelay:calc\(([\d.]+)s/g)].map(m => parseFloat(m[1]));
    assert.equal(delays.length, 3);
    assert.ok(delays[1] > delays[0] && delays[2] > delays[1], 'delays must increase left to right');
  });

  test('handles a single-digit amount', () => {
    const html = OBJECTS.bits.render({ username: 'T', amount: 1, message: null });
    const tiles = [...html.matchAll(/class="o-bits-tile"[^>]*>(\d)</g)].map(m => m[1]);
    assert.deepEqual(tiles, ['1']);
  });

  test('renders the dashboard test-event payload (src/routes/dashboard.js)', () => {
    // Exact shape fired by router.post('/overlay/test/:eventType')'s 'bits' case.
    // Regression pin: the old code read d.bits (always undefined on this shape)
    // and silently rendered a single "0" tile for every real cheer.
    const payload = { username: 'NitroFan', amount: 500, message: 'Take my bits!' };
    const html = OBJECTS.bits.render(payload);
    const tiles = [...html.matchAll(/class="o-bits-tile"[^>]*>(\d)</g)].map(m => m[1]);
    assert.equal(tiles.join(''), '500', 'must read d.amount — the shape every real producer emits');
  });
});

describe('donation — byobu screen', () => {
  test('unfolds exactly six panels with increasing delay', () => {
    const html = OBJECTS.donation.render({ username: 'PitBoss92', amount: '25.00', currency: 'EUR' });
    const panels = [...html.matchAll(/class="o-don-panel"/g)];
    assert.equal(panels.length, 6, 'six panels — the most built-up object in the set');
    const delays = [...html.matchAll(/--rdelay:calc\(([\d.]+)s/g)].map(m => parseFloat(m[1]));
    assert.equal(delays.length, 6);
    for (let i = 1; i < delays.length; i++) {
      assert.ok(delays[i] > delays[i - 1], `panel ${i} must unfold after panel ${i - 1}`);
    }
  });

  test('formats the amount with its currency symbol', () => {
    const eur = OBJECTS.donation.render({ username: 'A', amount: '25.00', currency: 'EUR' });
    assert.ok(eur.includes('€25.00'), 'EUR renders as the euro sign');
    const usd = OBJECTS.donation.render({ username: 'A', amount: '10.00', currency: 'USD' });
    assert.ok(usd.includes('$10.00'), 'USD renders as a dollar sign');
  });

  test('writes a code Intl cannot format in front of the amount', () => {
    const html = OBJECTS.donation.render({ username: 'A', amount: '5.00', currency: 'NOPE' });
    assert.ok(html.includes('NOPE 5.00'));
  });

  test('renders the donor message below the amount, escaped', () => {
    const html = OBJECTS.donation.render({
      username: 'PitBoss92', amount: '25.00', currency: 'EUR', message: '<i>nice</i> race!',
    });
    assert.match(html, /class="o-don-msg"/);
    assert.ok(html.includes('&lt;i&gt;nice&lt;/i&gt; race!'), 'must escape the message');
    assert.ok(!html.includes('<i>nice</i>'), 'must not emit raw user HTML');
    assert.ok(html.indexOf('o-don-amt') < html.indexOf('o-don-msg'), 'message must render below the amount');
  });

  test('omits the message element when message is absent', () => {
    const html = OBJECTS.donation.render({ username: 'A', amount: '5.00', currency: 'EUR' });
    assert.ok(!html.includes('o-don-msg'), 'no message data means no message element');
  });
});

describe('raid — sashimono rank', () => {
  test('plants five banners with the standard landing last', () => {
    const html = OBJECTS.raid.render({ username: 'GridWalker', viewers: 42 });
    const bans = [...html.matchAll(/class="o-raid-ban[^"]*"[^>]*--rdelay:calc\(([\d.]+)s/g)]
      .map(m => parseFloat(m[1]));
    assert.equal(bans.length, 5, 'five banners — a unit arriving');
    const mainDelay = parseFloat(
      html.match(/class="o-raid-ban main"[^>]*--rdelay:calc\(([\d.]+)s/)[1]);
    assert.equal(mainDelay, Math.max(...bans), 'the standard must land last');
  });

  test('shows the raider count and name', () => {
    const html = OBJECTS.raid.render({ username: 'GridWalker', viewers: 42 });
    assert.match(html, />42</);
    assert.ok(html.includes('GridWalker'));
  });

  test('defaults the count to 0 when viewers is missing', () => {
    const html = OBJECTS.raid.render({ username: 'GridWalker' });
    assert.match(html, />0</);
  });
});

// ── Donation amounts (N4) ─────────────────────────────────────────────────

describe('donation amounts are written the way the currency writes them', () => {
  // Intl separates a currency code from the number with a no-break space.
  const amountOf = (data) => {
    const html = OBJECTS.donation.render({ username: 'A', ...data });
    return html.match(/class="o-don-amt">([^<]*)</)[1].replace(/ /g, ' ');
  };

  test('always two decimals: EUR 10.5 is €10.50, not €10.5', () => {
    assert.equal(amountOf({ amount: 10.5, currency: 'EUR' }), '€10.50');
    assert.equal(amountOf({ amount: '25.00', currency: 'EUR' }), '€25.00');
  });

  test('thousands are grouped: USD 1234.5 is $1,234.50', () => {
    assert.equal(amountOf({ amount: 1234.5, currency: 'USD' }), '$1,234.50');
  });

  test('CAD and AUD say which dollar they are', () => {
    assert.equal(amountOf({ amount: 7.5, currency: 'CAD' }), 'CA$7.50');
    assert.equal(amountOf({ amount: 7.5, currency: 'AUD' }), 'A$7.50');
  });

  test('a currency without decimals has none (JPY)', () => {
    assert.equal(amountOf({ amount: 500, currency: 'JPY' }), '¥500');
  });

  test('a code in lower case, or with spaces around it, still works', () => {
    assert.equal(amountOf({ amount: 5, currency: 'eur' }), '€5.00');
    assert.equal(amountOf({ amount: 5, currency: ' usd ' }), '$5.00');
  });

  test('a currency Intl knows by code only is shown with the code (SEK)', () => {
    assert.equal(amountOf({ amount: 5, currency: 'SEK' }), 'SEK 5.00');
  });

  test('a code Intl cannot format is written in front of the amount, never thrown on', () => {
    assert.equal(amountOf({ amount: 5, currency: 'NOPE' }), 'NOPE 5.00');
    assert.equal(amountOf({ amount: 5, currency: '€' }), '€ 5.00');
    assert.equal(amountOf({ amount: 5, currency: '12' }), '12 5.00');
  });

  test('no currency at all is just the amount to two decimals', () => {
    assert.equal(amountOf({ amount: 5 }), '5.00');
    assert.equal(amountOf({ amount: 5, currency: null }), '5.00');
    assert.equal(amountOf({ amount: 5, currency: '' }), '5.00');
  });

  test('an amount that is not a number is shown as it came', () => {
    assert.equal(amountOf({ amount: 'abc', currency: 'EUR' }), 'EUR abc');
    assert.equal(amountOf({ amount: '1,234.50', currency: 'USD' }), 'USD 1,234.50');
    assert.equal(amountOf({ currency: 'EUR' }), 'EUR');
    assert.equal(amountOf({ amount: '', currency: 'EUR' }), 'EUR');
  });

  test('a hostile currency is escaped like every other text', () => {
    const html = OBJECTS.donation.render({ username: 'A', amount: 5, currency: '<img src=x onerror=1>' });
    assert.ok(!html.includes('<img src=x'), 'no raw markup from the currency');
    assert.ok(html.includes('&lt;IMG SRC=X ONERROR=1&gt; 5.00'));
  });
});

// ── Long names and big counts (N3) ────────────────────────────────────────

describe('a long name is shown in full when it can fit, and cut cleanly when it cannot', () => {
  const NAME_25 = 'A_Really_Long_Name_25ch!!'; // Twitch allows 25 characters
  const nameTag = (html) => html.match(/<div class="(?:o-bits-who )?o-name"([^>]*)>/)[1];
  const fitOf = (html) => {
    const m = /--fit:([\d.]+)/.exec(nameTag(html));
    return m ? Number(m[1]) : 1;
  };
  const RENDERS = {
    follow: (name) => OBJECTS.follow.render({ username: name }),
    subscription: (name) => OBJECTS.subscription.render({ username: name, tier: '1', months: 12 }),
    bits: (name) => OBJECTS.bits.render({ username: name, amount: 500 }),
    raid: (name) => OBJECTS.raid.render({ username: name, viewers: 42 }),
  };

  test('a 25-character name is in the markup in full for every object that shows a name', () => {
    assert.equal(NAME_25.length, 25);
    for (const [key, render] of Object.entries(RENDERS)) {
      assert.ok(render(NAME_25).includes(NAME_25), `${key} must not cut the name in the data`);
    }
  });

  test('a short name is set at full size (no --fit)', () => {
    for (const [key, render] of Object.entries(RENDERS)) {
      assert.equal(nameTag(render('RacerDan')), '', `${key}: short names carry no style`);
    }
  });

  test('a 25-character name is set smaller, and the narrow sub plaque shrinks it the most', () => {
    const fits = Object.fromEntries(Object.entries(RENDERS).map(([key, render]) => [key, fitOf(render(NAME_25))]));
    for (const [key, fit] of Object.entries(fits)) assert.ok(fit < 1 && fit >= 0.6, `${key}: --fit ${fit} within 0.6-1`);
    assert.ok(fits.subscription < fits.follow && fits.subscription < fits.raid && fits.subscription < fits.bits,
      JSON.stringify(fits));
  });

  test('the smaller size is only a step towards the floor, which keeps a name readable', () => {
    for (const render of Object.values(RENDERS)) assert.equal(fitOf(render('W'.repeat(60))), 0.6);
  });

  test('a longer name never gets a bigger size than a shorter one', () => {
    for (const [key, render] of Object.entries(RENDERS)) {
      let previous = 1;
      for (let length = 1; length <= 40; length++) {
        const fit = fitOf(render('N'.repeat(length)));
        assert.ok(fit <= previous, `${key} at ${length} characters`);
        previous = fit;
      }
    }
  });

  test('wide characters take more room than Latin ones, so a Japanese name shrinks sooner', () => {
    const latin = fitOf(RENDERS.subscription('A'.repeat(12)));
    const wide = fitOf(RENDERS.subscription('あ'.repeat(12)));
    assert.equal(latin, 1);
    assert.ok(wide < 1);
  });

  test('a hostile long name is still escaped, and the style carries only a number', () => {
    const hostile = '<img src=x onerror=alert(1)>'.repeat(2);
    for (const [key, render] of Object.entries(RENDERS)) {
      const html = render(hostile);
      assert.ok(!html.includes('<img src=x'), `${key}: raw markup`);
      assert.match(nameTag(html), /^ style="--fit:[\d.]+"$/, `${key}: the style holds nothing but --fit`);
    }
  });
});

describe('raid — a big count stays inside its banner', () => {
  const countTag = (viewers) => OBJECTS.raid.render({ username: 'GridWalker', viewers })
    .match(/<div class="o-raid-cnt"([^>]*)>(\d+)</);
  const sizeOf = (viewers) => {
    const m = /font-size:(\d+)px/.exec(countTag(viewers)[1]);
    return m ? Number(m[1]) : 46;
  };

  test('a six-digit count is shown in full, set smaller', () => {
    const [, tag, text] = countTag(123456);
    assert.equal(text, '123456');
    assert.match(tag, /font-size:\d+px/);
    assert.ok(sizeOf(123456) <= 34, `6 digits at ${sizeOf(123456)}px`);
    // 6 digits of 0.533em must fit the 118px banner
    assert.ok(6 * 0.533 * sizeOf(123456) <= 118);
  });

  test('up to four digits keep the full 46px size (no inline style)', () => {
    for (const viewers of [0, 7, 42, 999, 1234]) assert.equal(countTag(viewers)[1], '', String(viewers));
  });

  test('every digit count up to ten fits the banner, and more digits never mean a bigger size', () => {
    let previous = 46;
    for (let digits = 1; digits <= 10; digits++) {
      const viewers = Number('9'.repeat(digits));
      const size = sizeOf(viewers);
      assert.ok(size <= previous, `${digits} digits`);
      assert.ok(size >= 14, `${digits} digits are not set below 14px`);
      if (size > 14) assert.ok(digits * 0.533 * size <= 118, `${digits} digits at ${size}px fit the 118px banner`);
      previous = size;
    }
  });
});

describe('objects.css — display font and name fitting (N2, N3)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'objects', 'objects.css'), 'utf8');
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(m, `rule ${selector} exists`);
    return m[1];
  };

  test('every object uses the display font (--o-disp was defined but never applied)', () => {
    assert.match(css, /--o-disp:\s*"Oxanium"/);
    assert.match(rule('.obj'), /font-family:\s*var\(--o-disp\)/);
  });

  test('the condensed font is still used where it was', () => {
    assert.match(rule('.o-meta'), /font-family:\s*var\(--o-cond\)/);
  });

  test('a name never wraps or spills: one line, clipped with an ellipsis', () => {
    const name = rule('.o-name');
    assert.match(name, /white-space:\s*nowrap/);
    assert.match(name, /overflow:\s*hidden/);
    assert.match(name, /text-overflow:\s*ellipsis/);
  });

  test('every size of a name scales with --fit', () => {
    assert.match(rule('.o-name'), /font-size:\s*calc\(24px \* var\(--fit,\s*1\)\)/);
    assert.match(rule('.o-follow .o-name'), /font-size:\s*calc\(22px \* var\(--fit,\s*1\)\)/);
    assert.match(rule('.o-raid .o-name'), /font-size:\s*calc\(21px \* var\(--fit,\s*1\)\)/);
  });

  test('the raid count never wraps', () => {
    assert.match(rule('.o-raid .o-raid-cnt'), /white-space:\s*nowrap/);
  });
});
