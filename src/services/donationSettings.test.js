'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  TIP_GOAL_CURRENCIES, parseDonationSettings, parseTipGoalFields, errorMessage, goalCurrencyMismatch,
  SETTINGS_ERRORS, GOAL_ERRORS, MIN_AMOUNT_FLOOR, MIN_AMOUNT_CEIL, PAYPAL_EMAIL_MAX,
} = require('./donationSettings');

const form = (over) => ({
  paypal_email: ' streamer@example.com ', donation_page_enabled: '1', donation_min_amount: '2.5', donation_currency: 'USD', ...over,
});

describe('parseDonationSettings', () => {
  test('accepts a valid form and normalises it', () => {
    assert.deepEqual(parseDonationSettings(form()), {
      settings: { paypal_email: 'streamer@example.com', donation_page_enabled: 1, donation_min_amount: 2.5, donation_currency: 'USD' },
    });
    const off = parseDonationSettings(form({ donation_page_enabled: undefined, donation_currency: 'eur', paypal_email: '' }));
    assert.deepEqual(off.settings, { paypal_email: null, donation_page_enabled: 0, donation_min_amount: 2.5, donation_currency: 'EUR' });
  });

  test('only the listed currencies are accepted', () => {
    assert.deepEqual(TIP_GOAL_CURRENCIES, ['EUR', 'USD', 'GBP', 'BRL', 'CAD', 'AUD']);
    for (const c of TIP_GOAL_CURRENCIES) assert.equal(parseDonationSettings(form({ donation_currency: c })).settings.donation_currency, c);
    for (const donation_currency of ['JPY', 'EUR\\', 'EURO', '', undefined, ['EUR']]) {
      assert.deepEqual(parseDonationSettings(form({ donation_currency })), { error: 'currency' });
    }
  });

  test('the minimum amount is clamped to 0.50 – 10000', () => {
    assert.equal(MIN_AMOUNT_FLOOR, 0.5);
    assert.equal(MIN_AMOUNT_CEIL, 10000);
    const min = (v) => parseDonationSettings(form({ donation_min_amount: v })).settings.donation_min_amount;
    assert.equal(min('-5'), 0.5);
    assert.equal(min('0.1'), 0.5);
    assert.equal(min('0.5'), 0.5);
    assert.equal(min('7'), 7);
    assert.equal(min('10000'), 10000);
    assert.equal(min('25000'), 10000);
    assert.equal(min('1e9'), 10000);
  });

  test('a minimum amount that is not a number is refused', () => {
    for (const donation_min_amount of ['abc', '', 'Infinity', '-Infinity', 'NaN', undefined]) {
      assert.deepEqual(parseDonationSettings(form({ donation_min_amount })), { error: 'min_amount' });
    }
  });

  test('the PayPal email must look like an email and fit in 254 characters', () => {
    assert.equal(PAYPAL_EMAIL_MAX, 254);
    const domain = '@example.com';
    const longest = 'a'.repeat(PAYPAL_EMAIL_MAX - domain.length) + domain;
    assert.equal(parseDonationSettings(form({ paypal_email: longest })).settings.paypal_email, longest);
    assert.deepEqual(parseDonationSettings(form({ paypal_email: 'a' + longest })), { error: 'email' });
    for (const paypal_email of ['not-an-email', 'a b@example.com', 'a@b', '@example.com', 'a@@example.com',
      'a@example.com\u0000', '<a@example.com>', ['a@example.com']]) {
      assert.deepEqual(parseDonationSettings(form({ paypal_email })), { error: 'email' }, String(paypal_email));
    }
    assert.equal(parseDonationSettings(form({ paypal_email: 'First.Last+tips@sub.example.co.uk' })).settings.paypal_email,
      'First.Last+tips@sub.example.co.uk');
  });

  test('an empty or missing email turns the page address off, as before', () => {
    assert.equal(parseDonationSettings(form({ paypal_email: '   ' })).settings.paypal_email, null);
    assert.equal(parseDonationSettings(form({ paypal_email: undefined })).settings.paypal_email, null);
  });

  test('a missing body is refused instead of throwing', () => {
    assert.deepEqual(parseDonationSettings(undefined), { error: 'currency' });
  });
});

describe('parseTipGoalFields', () => {
  test('returns the cleaned fields', () => {
    assert.deepEqual(parseTipGoalFields({ title: '  New pedals  ', target_amount: '250.5', bar_color: '#AbCdEf' }),
      { title: 'New pedals', target_amount: 250.5, bar_color: '#AbCdEf' });
    assert.equal(parseTipGoalFields({ title: 'x'.repeat(80), target_amount: '5' }).title.length, 60);
  });

  test('returns error codes, not text', () => {
    assert.deepEqual(parseTipGoalFields({ title: '   ', target_amount: '5' }), { error: 'title_required' });
    for (const target_amount of ['0', '-1', 'abc', '10000001', undefined]) {
      assert.deepEqual(parseTipGoalFields({ title: 'Pedals', target_amount }), { error: 'target_invalid' });
    }
    assert.deepEqual(parseTipGoalFields(undefined), { error: 'title_required' });
  });

  test('an invalid bar colour falls back to the default green', () => {
    for (const bar_color of ['red', '#fff', '#12345g', ['#ffffff'], undefined]) {
      assert.equal(parseTipGoalFields({ title: 'Pedals', target_amount: '5', bar_color }).bar_color, '#22c55e');
    }
  });

  test('every error code it returns has a message', () => {
    for (const code of ['title_required', 'target_invalid', 'not_found', 'amount_invalid']) assert.ok(GOAL_ERRORS[code], code);
    for (const code of ['currency', 'min_amount', 'email']) assert.ok(SETTINGS_ERRORS[code], code);
  });
});

describe('errorMessage', () => {
  const t = (key, params) => `${key}|${JSON.stringify(params || {})}`;

  test('maps a known code to its translated message', () => {
    assert.equal(errorMessage(GOAL_ERRORS, 'title_required', t), 'donations.goal.error.titleRequired|{}');
    assert.equal(errorMessage(SETTINGS_ERRORS, 'min_amount', t, { min: '0.50' }), 'donations.error.minAmount|{"min":"0.50"}');
  });

  test('ignores unknown codes and text from the URL', () => {
    for (const code of ['Any text someone put in a link', 'constructor', '__proto__', 'toString', '', undefined, ['title_required']]) {
      assert.equal(errorMessage(GOAL_ERRORS, code, t), null, String(code));
    }
  });
});

describe('goalCurrencyMismatch', () => {
  test('warns only when the active goal and the tip page use different currencies', () => {
    assert.equal(goalCurrencyMismatch(null, { donation_currency: 'EUR' }), null);
    assert.equal(goalCurrencyMismatch({ currency: 'EUR' }, { donation_currency: 'EUR' }), null);
    assert.equal(goalCurrencyMismatch({ currency: 'eur' }, { donation_currency: 'EUR' }), null);
    assert.deepEqual(goalCurrencyMismatch({ currency: 'USD' }, { donation_currency: 'EUR' }), { goal: 'USD', page: 'EUR' });
    // A streamer who never saved the settings has a EUR tip page.
    assert.equal(goalCurrencyMismatch({ currency: 'EUR' }, { donation_currency: null }), null);
    assert.deepEqual(goalCurrencyMismatch({ currency: 'GBP' }, {}), { goal: 'GBP', page: 'EUR' });
  });
});
