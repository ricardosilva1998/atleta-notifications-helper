'use strict';

// src/services/alertStyles.js: the looks the server lets a streamer save, read from the registry.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const styles = require('../src/services/alertStyles');
const K = require('../public/overlay/objects/kit.js');

const vilela = { twitch_user_id: '632557806' };
const someone = { twitch_user_id: '123' };

describe('the catalogue', () => {
  test('lists every registered look, once, in family order', () => {
    const ids = styles.lookIds();
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ['follow-samurai', 'giveaway-samurai', 'follow-racing', 'giveaway-racing']) assert.ok(ids.includes(id), id);
    assert.deepEqual(styles.familyKeys().slice(0, 2), ['samurai', 'racing']);
  });

  test('every family draws all six alerts', () => {
    for (const family of styles.familyKeys()) assert.ok(styles.familyStyles(family), family);
  });

  test('the default looks are registered and draw their own alert', () => {
    for (const [alert, id] of Object.entries(styles.DEFAULT_STYLES)) assert.equal(styles.lookOf(id).eventType, alert, id);
  });

  test('every look\'s default sound is one a design may name', () => {
    const sounds = styles.soundKeys();
    for (const id of styles.lookIds()) assert.ok(sounds.includes(styles.lookOf(id).sound), `${id}: ${styles.lookOf(id).sound}`);
  });

  test('every look\'s sound is in a family\'s group, each once', () => {
    const grouped = styles.soundGroups().flatMap((g) => g.sounds);
    assert.equal(new Set(grouped).size, grouped.length);
    assert.deepEqual([...grouped].sort(), styles.soundKeys().filter((k) => k !== 'today' && k !== 'none'));
    assert.deepEqual(styles.soundGroups().map((g) => g.family).slice(0, 2), ['samurai', 'racing']);
    assert.ok(styles.soundGroups()[0].sounds.includes('samuraiBell'));
  });

  test('the fonts of a family, once each', () => {
    assert.deepEqual(styles.fontsOf(['racing', 'racing']), K.families.racing.fonts);
    assert.deepEqual(styles.fontsOf(['nope']), []);
  });
});

describe('who may save which look', () => {
  test('a public look of the alert, or none', () => {
    assert.equal(styles.canUseStyle('follow-racing', 'follow', someone), true);
    assert.equal(styles.canUseStyle(null, 'follow', someone), true);
    assert.equal(styles.canUseStyle(null, 'yt_member', someone), true);
  });

  test('not a look of another alert, an unknown look, or a look for a YouTube alert', () => {
    assert.equal(styles.canUseStyle('bits-racing', 'follow', someone), false);
    assert.equal(styles.canUseStyle('follow-nothing', 'follow', someone), false);
    assert.equal(styles.canUseStyle('follow-racing', 'yt_member', someone), false);
    assert.equal(styles.canUseStyle(42, 'follow', someone), false);
  });

  test('a private look only for its owner, and only for its alert', () => {
    assert.equal(styles.canUseStyle('donation-c1', 'donation', vilela), true);
    assert.equal(styles.canUseStyle('donation-c1', 'donation', someone), false);
    assert.equal(styles.canUseStyle('donation-c1', 'donation', null), false);
    assert.equal(styles.canUseStyle('donation-c1', 'follow', vilela), false);
  });

  test('the C1 with the streamer\'s own name: any streamer\'s donation, and only the donation', () => {
    assert.equal(styles.canUseStyle('donation-c1-channel', 'donation', someone), true);
    assert.equal(styles.canUseStyle('donation-c1-channel', 'donation', vilela), true);
    assert.equal(styles.canUseStyle('donation-c1-channel', 'follow', someone), false);
    assert.equal(styles.canUseStyle('donation-c1-channel', 'yt_superchat', someone), false);
  });
});

describe('the gallery', () => {
  test('shows the owner\'s private look first, and no one else\'s', () => {
    assert.deepEqual(styles.galleryFor('donation', vilela)[0], { id: 'donation-c1', family: null, mine: true });
    assert.ok(!styles.galleryFor('donation', someone).some((e) => e.id === 'donation-c1'));
    assert.deepEqual(styles.galleryFor('yt_member', someone), []);
  });

  test('every streamer\'s donation gallery has the C1 with their own name, after a look made for them and before the families', () => {
    const gallery = styles.galleryFor('donation', someone);
    assert.deepEqual(gallery[0], { id: 'donation-c1-channel', family: null, mine: false });
    assert.ok(gallery.slice(1).length && gallery.slice(1).every((e) => e.family), 'then the families');
    assert.deepEqual(styles.galleryFor('donation', vilela).slice(0, 2).map((e) => e.id), ['donation-c1', 'donation-c1-channel']);
    for (const alert of ['follow', 'subscription', 'bits', 'raid', 'giveaway_winner']) {
      assert.ok(!styles.galleryFor(alert, someone).some((e) => e.id === 'donation-c1-channel'), alert);
    }
  });

  test('a family\'s six looks; nothing for an unknown family', () => {
    assert.deepEqual(styles.familyStyles('racing'), {
      follow: 'follow-racing', subscription: 'subscriber-racing', bits: 'bits-racing',
      donation: 'donation-racing', raid: 'raid-racing', giveaway_winner: 'giveaway-racing',
    });
    assert.equal(styles.familyStyles('nope'), null);
    assert.equal(styles.familyStyles('__proto__'), null);
  });
});

describe('the families of Appendix A', () => {
  // In the gallery's order. Release B adds them one task at a time
  // (docs/superpowers/plans/2026-10-15-alert-styles-release-b.md).
  const FAMILIES = ['samurai', 'racing'];
  test('are the gallery\'s families, in its order, each drawing all six alerts', () => {
    assert.deepEqual(styles.familyKeys(), FAMILIES);
    for (const family of FAMILIES) assert.ok(styles.familyStyles(family), `${family} draws all six alerts`);
  });
});
