'use strict';

// Form rules for /dashboard/donations: the tip page settings and the tip goal.
// Pure functions, so the routes stay small and the rules are unit-tested.

// The currencies the tip page and tip goals offer (the settings page lists the same six).
const TIP_GOAL_CURRENCIES = ['EUR', 'USD', 'GBP', 'BRL', 'CAD', 'AUD'];

const MIN_AMOUNT_FLOOR = 0.5;
const MIN_AMOUNT_CEIL = 10000;
const PAYPAL_EMAIL_MAX = 254;
// A shape check only: one @, no spaces, quotes, angle brackets or control
// characters, and a dot in the domain. PayPal rejects addresses it cannot pay.
const EMAIL_RE = /^[^\s\x00-\x1f\x7f@"<>]+@[^\s\x00-\x1f\x7f@"<>]+\.[^\s\x00-\x1f\x7f@"<>.]{2,}$/;

// Error codes the routes put in the URL -> locale keys. The page only ever shows
// these messages, never text taken from the URL.
const SETTINGS_ERRORS = {
  currency: 'donations.error.currency',
  min_amount: 'donations.error.minAmount',
  email: 'donations.error.email',
};

const GOAL_ERRORS = {
  title_required: 'donations.goal.error.titleRequired',
  target_invalid: 'donations.goal.error.targetInvalid',
  not_found: 'donations.goal.error.notFound',
  amount_invalid: 'donations.goal.error.amountInvalid',
};

// The donation settings form. Returns { settings } ready for
// db.updateDonationSettings(), or { error: code } from SETTINGS_ERRORS.
function parseDonationSettings(body) {
  const b = body || {};

  const currency = typeof b.donation_currency === 'string' ? b.donation_currency.trim().toUpperCase() : '';
  if (!TIP_GOAL_CURRENCIES.includes(currency)) return { error: 'currency' };

  const min = parseFloat(b.donation_min_amount);
  if (!Number.isFinite(min)) return { error: 'min_amount' };

  const rawEmail = b.paypal_email == null ? '' : b.paypal_email;
  if (typeof rawEmail !== 'string') return { error: 'email' };
  const email = rawEmail.trim();
  if (email && (email.length > PAYPAL_EMAIL_MAX || !EMAIL_RE.test(email))) return { error: 'email' };

  return {
    settings: {
      paypal_email: email || null,
      donation_page_enabled: b.donation_page_enabled ? 1 : 0,
      donation_min_amount: Math.round(Math.min(MIN_AMOUNT_CEIL, Math.max(MIN_AMOUNT_FLOOR, min)) * 100) / 100,
      donation_currency: currency,
    },
  };
}

// The tip goal create/edit form. Returns the fields, or { error: code } from GOAL_ERRORS.
function parseTipGoalFields(body) {
  const b = body || {};
  const title = String(b.title || '').trim().substring(0, 60);
  const target = Math.round(parseFloat(b.target_amount) * 100) / 100;
  const barColor = typeof b.bar_color === 'string' && /^#[0-9a-f]{6}$/i.test(b.bar_color) ? b.bar_color : '#22c55e';
  if (!title) return { error: 'title_required' };
  if (!Number.isFinite(target) || target <= 0 || target > 10000000) return { error: 'target_invalid' };
  return { title, target_amount: target, bar_color: barColor };
}

// The translated message for an error code from the URL, or null for anything
// that is not one of `map`'s own codes.
function errorMessage(map, code, t, params) {
  if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(map, code)) return null;
  return t(map[code], params);
}

// The tip page charges in donation_currency (EUR when never set), and tips in
// another currency never count toward the goal. Returns both currencies when they
// differ, else null.
function goalCurrencyMismatch(goal, streamer) {
  if (!goal) return null;
  const page = (streamer && streamer.donation_currency) || 'EUR';
  if (String(goal.currency).toUpperCase() === String(page).toUpperCase()) return null;
  return { goal: goal.currency, page };
}

module.exports = {
  TIP_GOAL_CURRENCIES,
  MIN_AMOUNT_FLOOR,
  MIN_AMOUNT_CEIL,
  PAYPAL_EMAIL_MAX,
  SETTINGS_ERRORS,
  GOAL_ERRORS,
  parseDonationSettings,
  parseTipGoalFields,
  errorMessage,
  goalCurrencyMismatch,
};
