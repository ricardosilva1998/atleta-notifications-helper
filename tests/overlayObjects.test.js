'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const OBJECTS = require('../public/overlay/objects/index.js');

const KEYS = ['follow', 'subscription', 'bits', 'donation', 'raid'];

describe('object registry contract', () => {
  test('exports exactly the five Twitch event types', () => {
    assert.deepEqual(Object.keys(OBJECTS).sort(), [...KEYS].sort());
  });

  // The shape every object and every style has. exitMs() in overlay.js reads exit.dur as seconds
  // (parseFloat), so a duration written as "900ms" would hold the alert queue for 15 minutes.
  function assertTimedObject(label, o) {
    assert.equal(typeof o.render, 'function', `${label}: render must be a function`);
    for (const phase of ['anim', 'exit']) {
      assert.ok(o[phase], `${label}: missing ${phase}`);
      assert.match(o[phase].dur, /^\d+(\.\d+)?s$/, `${label}: ${phase}.dur must be like "0.40s"`);
      assert.equal(typeof o[phase].ease, 'string', `${label}: ${phase}.ease must be a string`);
    }
    assert.equal(typeof o.anim.in, 'string', `${label}: anim.in must name a keyframe`);
    assert.equal(typeof o.exit.out, 'string', `${label}: exit.out must name a keyframe`);
  }

  test('every object has a render function and timing metadata', () => {
    for (const k of KEYS) {
      assert.equal(OBJECTS[k].key, k, `${k}: key must match its registry slot`);
      assertTimedObject(k, OBJECTS[k]);
    }
  });

  test('every style has the same shape, is filed under its own id and names the alert it draws', () => {
    const styles = Object.entries(OBJECTS.STYLES);
    assert.ok(styles.length >= 1, 'there is at least one style');
    for (const [id, style] of styles) {
      assert.equal(style.key, id, `${id}: key must match its STYLES slot (objectFor() compares them)`);
      assert.equal(typeof style.eventType, 'string', `${id}: eventType names the alert it draws`);
      assertTimedObject(id, style);
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

  test('every name is in the span that clips it, and still escaped there', () => {
    for (const [key, render] of Object.entries(RENDERS)) {
      const html = render('<i>Ana</i> & Ço');
      assert.ok(html.includes('<span class="o-name-text">&lt;i&gt;Ana&lt;/i&gt; &amp; Ço</span></div>'), key);
      assert.ok(!html.includes('<i>Ana</i>'), `${key}: no raw markup`);
    }
  });

  test('accented names are carried whole into the markup', () => {
    for (const [key, render] of Object.entries(RENDERS)) {
      assert.ok(render('ÅÜÃ JOÃO ANDRÉ').includes('ÅÜÃ JOÃO ANDRÉ'), key);
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
    const text = rule('.o-name-text');
    assert.match(text, /display:\s*block/);
    assert.match(text, /white-space:\s*nowrap/);
    assert.match(text, /overflow:\s*hidden/);
    assert.match(text, /text-overflow:\s*ellipsis/);
  });

  test('the clip does not cut an accent or a descender: the span is padded and pulled back by the same amount', () => {
    // An A-tilde or A-ring rises above the line and a Q hangs below it; a clipping box cuts both.
    const text = rule('.o-name-text');
    const padding = /padding:\s*([\d.]+)em 0/.exec(text);
    const margin = /margin:\s*-([\d.]+)em 0/.exec(text);
    assert.ok(padding && margin, 'padding and a negative margin of the same size, top and bottom');
    assert.equal(padding[1], margin[1]);
    assert.ok(Number(padding[1]) >= 0.25, 'room for a capital with an accent');
  });

  test('so the name box itself stays one line tall, and its own margins cannot collapse into the span\'s', () => {
    const box = rule('.o-name');
    assert.match(box, /display:\s*flow-root/);
    assert.match(box, /line-height:\s*1\.08/);
    assert.ok(!/overflow:/.test(box), 'the box itself clips nothing');
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

// ── Styles: an alert drawn in another look (andre_vilela_'s C1) ─────────

describe("styles — andre_vilela_'s C1 donation alert (donation-c1)", () => {
  const STYLES = OBJECTS.STYLES;
  const C1 = STYLES && STYLES['donation-c1'];
  const tip = (over = {}) => C1.render({ username: 'PitBoss92', amount: '25.00', currency: 'EUR', message: 'Força Vilela!', ...over });
  const hasClass = (html, name) => new RegExp(`class="(?:[^"]* )?${name}(?: [^"]*)?"`).test(html);
  const ids = (html) => [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);

  test('rides along with the registry without changing the five', () => {
    assert.deepEqual(Object.keys(OBJECTS).sort(), [...KEYS].sort(), 'Object.keys still lists only the five');
    assert.ok(STYLES, 'STYLES is on the export');
    assert.deepEqual(Object.keys(STYLES), ['donation-c1', 'donation-c1-channel']);
  });

  test('has the registry shape, the id it is filed under and the alert it draws', () => {
    assert.equal(C1.key, 'donation-c1');
    assert.equal(C1.eventType, 'donation');
    assert.equal(typeof C1.render, 'function');
    assert.deepEqual(C1.anim, { in: 'hold', dur: '1.25s', ease: 'linear' });
    assert.deepEqual(C1.exit, { out: 'hold', dur: '0.90s', ease: 'linear' });
  });

  test('is one object: the rig (trailer, board, car) and the smoke it leaves behind', () => {
    const html = tip();
    assert.match(html, /^<div class="obj o-c1">/);
    for (const part of ['o-c1-rig', 'o-c1-streaks', 'o-c1-trailer', 'o-c1-board', 'o-c1-tframe', 'o-c1-hitch', 'o-c1-car', 'o-c1-flame', 'o-c1-bsmoke', 'o-c1-exsmoke']) {
      assert.ok(hasClass(html, part), part);
    }
    assert.equal((html.match(/class="o-c1-tw"/g) || []).length, 2, 'two trailer wheels');
  });

  test('the car is the traced C1: its outline, both wheels, the name and the number', () => {
    const html = tip();
    assert.match(html, /<svg class="o-c1-svg" viewBox="0 0 320 140"/);
    assert.match(html, /class="o-c1-wheel o-c1-rear" transform="translate\(57 108\.5\)"/);
    assert.match(html, /class="o-c1-wheel o-c1-front" transform="translate\(249 108\.5\)"/);
    assert.match(html, /class="o-c1-decal"[^>]*>VILELA</);
    assert.match(html, /class="o-c1-num"[^>]*>1</);
  });

  test('the traced outline, the glass and the wheel wells are the committed prototype\'s, character for character, and the render prints them', () => {
    // The drawing was measured from a real C1 once (see the comment above C1_BODY): a path edited by accident
    // anywhere along its length must fail here, not only at its first characters.
    const prototype = fs.readFileSync(path.join(__dirname, '..', 'docs', 'superpowers', 'specs', 'assets', '2026-10-15-vilela-c1-donation-prototype.html'), 'utf8');
    const registry = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'objects', 'index.js'), 'utf8');
    const paths = (source, declaration) => Object.fromEntries([...source.matchAll(declaration)].map((m) => [m[1], m[2]]));
    const fromPrototype = paths(prototype, /const (BODY|DOOR_GLASS|QUARTER_GLASS|WELLS) = '([^']*)';/g);
    const fromRegistry = paths(registry, /var C1_(BODY|DOOR_GLASS|QUARTER_GLASS|WELLS) = '([^']*)';/g);
    const names = ['BODY', 'DOOR_GLASS', 'QUARTER_GLASS', 'WELLS'];
    assert.deepEqual(Object.keys(fromPrototype).sort(), [...names].sort(), 'the prototype declares the four paths');
    assert.deepEqual(Object.keys(fromRegistry).sort(), [...names].sort(), 'the registry declares the four paths');
    const html = tip();
    for (const name of names) {
      assert.ok(fromPrototype[name].length > 50, `${name} is a whole path, not a stub`);
      assert.equal(fromRegistry[name], fromPrototype[name], `C1_${name} is the prototype's ${name}`);
      assert.ok(html.includes(`d="${fromPrototype[name]}"`), `the render draws ${name}`);
    }
  });

  test('prints the board: Sponsor, the amount, the message in quotes and the name', () => {
    const html = tip();
    assert.ok(html.includes('<div class="o-c1-head">Sponsor</div>'));
    assert.ok(html.includes('<div class="o-c1-amt">€25.00</div>'));
    assert.ok(html.includes('<div class="o-c1-msg">&quot;Força Vilela!&quot;</div>'));
    assert.ok(html.includes('<div class="o-c1-from">PitBoss92</div>'));
  });

  test('escapes the name and the message', () => {
    const html = tip({ username: '<img src=x>Ap&x', message: '<b>hi</b>' });
    assert.ok(html.includes('&lt;img src=x&gt;Ap&amp;x'));
    assert.ok(html.includes('&lt;b&gt;hi&lt;/b&gt;'));
    assert.ok(!html.includes('<img src=x>') && !html.includes('<b>hi</b>'));
  });

  test('no message, no message line', () => {
    assert.ok(!tip({ message: '' }).includes('o-c1-msg'));
    assert.ok(!tip({ message: undefined }).includes('o-c1-msg'));
  });

  test('a long amount is set smaller so it stays on the board, never below 60 %', () => {
    assert.ok(tip().includes('<div class="o-c1-amt">€25.00</div>'), '€25.00 is at full size');
    assert.ok(tip({ amount: '1250' }).includes('<div class="o-c1-amt" style="--afit:0.78">€1,250.00</div>'));
    assert.ok(tip({ amount: '10000' }).includes('style="--afit:0.70">€10,000.00<'));
    assert.ok(tip({ amount: '1000000000' }).includes('style="--afit:0.60">'));
  });

  test('an amount in a long currency format is set smaller too (CA$1,250.00)', () => {
    assert.ok(tip({ amount: '1250', currency: 'CAD' }).includes('<div class="o-c1-amt" style="--afit:0.64">CA$1,250.00</div>'));
  });

  test('the amount is set smaller from its 8th character: 7 characters ($100.00) stay at full size, 8 (CA$25.00) get 7/8', () => {
    const amount = (html) => /<div class="o-c1-amt"([^>]*)>([^<]*)<\/div>/.exec(html);
    const seven = amount(tip({ amount: '100', currency: 'USD' }));
    assert.equal(seven[2], '$100.00', 'seven characters');
    assert.equal(seven[1], '', 'the board holds seven at 46px: no --afit');
    const eight = amount(tip({ amount: '25', currency: 'CAD' }));
    assert.equal(eight[2], 'CA$25.00', 'eight characters');
    assert.equal(eight[1], ' style="--afit:0.88"', '7 / 8 = 0.875, written with two decimals');
  });

  test('renders the dashboard test donation (src/routes/dashboard.js) in its currency', () => {
    assert.ok(C1.render({ username: 'BigSponsor', amount: 25, message: 'Keep racing!', currency: 'USD' }).includes('$25.00'));
  });

  test('every SVG id is its own: two alerts on one page never share a gradient or a clip path', () => {
    const a = tip();
    const b = tip();
    assert.ok(ids(a).length >= 6);
    assert.equal(new Set(ids(a)).size, ids(a).length, 'unique within one alert');
    assert.ok(ids(a).every((id) => !ids(b).includes(id)), 'unique between alerts');
    const own = new Set(ids(a));
    for (const [, ref] of a.matchAll(/url\(#([^)]+)\)/g)) assert.ok(own.has(ref), `url(#${ref}) points into the same alert`);
  });

  test('every class it uses is under the o-c1 prefix (besides the shared obj and o-mesh)', () => {
    const classes = [...tip().matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
    for (const name of classes) assert.ok(name === 'obj' || name === 'o-mesh' || name.startsWith('o-c1'), name);
  });
});

describe('styles — the C1 any streamer can pick, with their own name on it (donation-c1-channel)', () => {
  const STYLES = OBJECTS.STYLES;
  const ANY = STYLES && STYLES['donation-c1-channel'];
  const C1 = STYLES && STYLES['donation-c1'];
  const data = { username: 'PitBoss92', amount: '25.00', currency: 'EUR', message: 'Go!' };
  const lettering = (html) => {
    const m = /<text class="o-c1-decal"([^>]*)>([^<]*)<\/text>/.exec(html);
    return m ? { attrs: m[1], text: m[2] } : null;
  };
  const AT = ' x="88" y="38" text-anchor="middle"';
  const SQUEEZED = AT + ' textLength="30" lengthAdjust="spacingAndGlyphs"';
  // The page says whose overlay it is (window.ATLETA_CHANNEL, set by the overlay page and the
  // builder) and render() reads it as it draws. Node has no window, so the test lends one.
  function onPage(channel, render) {
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
    const before = globalThis.window;
    globalThis.window = channel === undefined ? {} : { ATLETA_CHANNEL: channel };
    try { return render(); } finally { if (had) globalThis.window = before; else delete globalThis.window; }
  }
  const draw = (channel) => onPage(channel, () => ANY.render(data));

  test('is the same C1, filed under its own id, for donations', () => {
    assert.ok(ANY, 'STYLES has donation-c1-channel');
    assert.equal(ANY.key, 'donation-c1-channel');
    assert.equal(ANY.eventType, 'donation');
    assert.deepEqual(ANY.anim, C1.anim);
    assert.deepEqual(ANY.exit, C1.exit);
    const drawing = (html) => html.replace(/oc1u\d+/g, 'U').replace(/<text class="o-c1-decal"[^>]*>[^<]*<\/text>/, '');
    assert.equal(drawing(draw('ABC')), drawing(onPage('ABC', () => C1.render(data))), 'everything but the lettering is his drawing');
  });

  test('a name that fits the glass is set like VILELA, at its own width and never stretched, however many letters it has', () => {
    // Widths measured in Chromium at the decal's font: PABLOS 26.1, JILLIAN 25.5, FIJI_11 22.5, TILLIE_1 27.9 (of 29).
    for (const name of ['PABLOS', 'JILLIAN', 'FIJI_11', 'TILLIE_1']) {
      assert.deepEqual(lettering(draw(name)), { attrs: AT, text: name }, name);
    }
  });

  test('a name wider than the glass is squeezed into its 30 units, short names of wide capitals too', () => {
    // RICARDO 29.8, MOMWOW 34.7, WWWWWW 39.4, RICARDOBSILVA98 62.7 (of 29).
    for (const name of ['RICARDO', 'MOMWOW', 'WWWWWW', 'RICARDOBSILVA98']) {
      assert.deepEqual(lettering(draw(name)), { attrs: SQUEEZED, text: name }, name);
    }
    assert.deepEqual(lettering(draw('ABCDEFGHIJKLMNOP')), { attrs: SQUEEZED, text: 'ABCDEFGHIJKLMNOP' }, 'sixteen characters are shown whole');
  });

  test("the width table was measured at the decal's font, size and spacing: changing them means measuring it again", () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'objects', 'objects.css'), 'utf8');
    assert.match(css, /\.o-c1 \.o-c1-decal\{font-family:var\(--o-cond\);font-weight:700;font-size:7\.5px;letter-spacing:\.9px;/);
  });

  test('a character the width table does not hold counts as the widest, so it never overruns the glass', () => {
    assert.deepEqual(lettering(draw('ÉÉÉÉÉ')), { attrs: SQUEEZED, text: 'ÉÉÉÉÉ' }, 'five unknown characters are wider than 29 units');
  });

  test('a name past sixteen characters is cut with …', () => {
    assert.deepEqual(lettering(draw('AVERYLONGTWITCHNAMEIS25CH')), { attrs: SQUEEZED, text: 'AVERYLONGTWITCH…' });
  });

  test('no name, no lettering: the window stays plain glass (a streamer without Twitch, or Node with no page)', () => {
    assert.equal(lettering(draw('')), null);
    assert.equal(lettering(draw(undefined)), null);
    assert.equal(typeof globalThis.window, 'undefined', 'this test file runs without a window');
    assert.equal(lettering(ANY.render(data)), null, 'no window at all');
    assert.match(draw(''), /^<div class="obj o-c1">/, 'still the whole C1');
  });

  test('the name is escaped like every text the registry prints', () => {
    // Its symbols are not in the width table, so they count as the widest and the name is squeezed.
    assert.deepEqual(lettering(draw('<B>&"X')), { attrs: SQUEEZED, text: '&lt;B&gt;&amp;&quot;X' });
  });

  test("andre_vilela_'s C1 keeps VILELA whatever name the page gives", () => {
    const html = onPage('SOMEONEELSE', () => C1.render(data));
    assert.ok(html.includes('<text class="o-c1-decal" x="88" y="38" text-anchor="middle">VILELA</text>'));
    assert.ok(!html.includes('SOMEONEELSE'));
  });
});

describe('objects.css — the C1 (donation-c1)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'objects', 'objects.css'), 'utf8');
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const defined = new Set([...css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(m, `rule ${selector} exists`);
    return m[1];
  };

  test('every keyframe the C1 names or plays is defined', () => {
    const c1 = OBJECTS.STYLES['donation-c1'];
    for (const name of [c1.anim.in, c1.exit.out]) assert.ok(defined.has(name), name);
    const played = new Set([...bare.matchAll(/\bc1[A-Z][A-Za-z]*\b/g)].map((m) => m[0]));
    assert.ok(played.size >= 16, 'the C1 has its own keyframes');
    for (const name of played) assert.ok(defined.has(name), `${name} is played but not defined`);
  });

  test('every C1 selector is under .o-c1, so none of its classes can collide with the builder page', () => {
    const selectors = [...bare.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim()).filter((s) => /o-c1/.test(s));
    assert.ok(selectors.length > 20);
    for (const selector of selectors) {
      for (const part of selector.split(',')) assert.match(part.trim(), /^(\.(playing|exiting) )?\.o-c1\b/, part.trim());
    }
  });

  test('the car drives in and out across the whole OBS source, whatever its size', () => {
    // A --fw declared on any element inside the builder preview's host would shadow the host's own (1920px).
    const header = css.indexOf('/* ══ 06 styles');
    assert.ok(header >= 0, 'the C1 section has its header comment');
    const nextHeader = css.indexOf('/* ══ ', header + 1);
    const section = css.slice(header, nextHeader === -1 ? undefined : nextHeader).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(section.includes('.o-c1{') && section.includes('.exiting .o-c1 .o-c1-rig{'), 'the slice runs from the first C1 rule to the last');
    assert.ok(!/--fw\s*:/.test(section), 'no rule in the C1 section declares --fw, so a parent (the builder preview) can set it');
    assert.ok(css.includes('@keyframes c1Arrive{from{transform:translateX(calc(-1 * var(--fw, 100vw)))}to{transform:translateX(0)}}'));
    assert.ok(css.includes('@keyframes c1Leave{from{transform:translateX(0)}to{transform:translateX(var(--fw, 100vw))}}'));
  });

  test('its exit outranks the shared .exiting .obj * that stops every other animation', () => {
    assert.match(css, /\n\.exiting \.o-c1 \.o-c1-rig\{animation:c1Leave /);
    assert.match(css, /\n\.exiting \.o-c1 \.o-c1-spin\{animation:c1SpinOut /);
  });

  test('the name stays on one line, cut with an ellipsis; the message has two lines at most', () => {
    const from = rule('.o-c1 .o-c1-from');
    assert.match(from, /white-space:\s*nowrap/);
    assert.match(from, /overflow:\s*hidden/);
    assert.match(from, /text-overflow:\s*ellipsis/);
    assert.match(rule('.o-c1 .o-c1-msg'), /-webkit-line-clamp:\s*2/);
    assert.match(rule('.o-c1 .o-c1-amt'), /white-space:\s*nowrap/);
  });

  test('the car takes 39 % of the alert, at most 230px, and the board the rest less the hitch', () => {
    assert.match(rule('.o-c1'), /--o-c1-cw:\s*min\(39%,\s*230px\)/);
    assert.match(rule('.o-c1 .o-c1-car'), /width:\s*var\(--o-c1-cw\)/);
    assert.match(rule('.o-c1 .o-c1-trailer'), /width:\s*calc\(100% - var\(--o-c1-cw\) - 14px\)/);
    assert.match(rule('.o-c1 .o-c1-board'), /box-sizing:\s*border-box/);
  });

  test('the message and the name are never squeezed: a flex item that clips would shrink below its lines', () => {
    assert.match(rule('.o-c1 .o-c1-msg'), /(?:^|;)flex:\s*none/);
    assert.match(rule('.o-c1 .o-c1-from'), /(?:^|;)flex:\s*none/);
  });

  test('the board holds its worst case in its 126px: the 46px amount, two message lines and the name', () => {
    const num = (text, re, what) => { const m = re.exec(text); assert.ok(m, `${what} is declared`); return Number(m[1]); };
    const optional = (text, re) => { const m = re.exec(text); return m ? Number(m[1]) : 0; };
    const lineBox = (selector, size) => {
      const body = rule(selector);
      return num(body, size, `${selector} font-size`) * num(body, /(?:^|;)line-height:\s*([\d.]+)(?:;|$)/, `${selector} line-height`);
    };
    const board = rule('.o-c1 .o-c1-board');
    const room = num(board, /(?:^|;)height:\s*([\d.]+)px/, 'the board height')
      - num(board, /(?:^|;)padding:\s*([\d.]+)px\s+[\d.]+px\s+[\d.]+px/, 'the top padding')
      - num(board, /(?:^|;)padding:\s*[\d.]+px\s+[\d.]+px\s+([\d.]+)px/, 'the bottom padding');
    const gaps = 3 * num(board, /(?:^|;)gap:\s*([\d.]+)px/, 'the gap');
    const margins = ['.o-c1 .o-c1-amt', '.o-c1 .o-c1-from'].reduce((sum, s) => sum + optional(rule(s), /(?:^|;)margin-top:\s*([\d.]+)px/), 0);
    const px = /(?:^|;)font-size:\s*([\d.]+)px/;
    const need = lineBox('.o-c1 .o-c1-head', px)
      + lineBox('.o-c1 .o-c1-amt', /(?:^|;)font-size:\s*calc\(([\d.]+)px/)
      + 2 * lineBox('.o-c1 .o-c1-msg', px)
      + lineBox('.o-c1 .o-c1-from', px)
      + gaps + margins;
    assert.ok(need <= room, `the worst case needs ${need}px between the paddings and the board has ${room}px`);
  });
});
