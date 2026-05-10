const { test } = require('node:test');
const assert = require('node:assert/strict');
// Import the pure template module directly — it has no external deps and does not
// touch config or DB, so it runs cleanly without environment variables.
const { formatChatTemplate } = require('./redemptionTemplates');

test('replaces all three placeholders', () => {
  const result = formatChatTemplate('{user} redeemed {title} for {cost}', {
    user: 'Bob',
    title: 'Air Horn',
    cost: 500,
  });
  assert.equal(result, 'Bob redeemed Air Horn for 500');
});

test('returns null for null template', () => {
  const result = formatChatTemplate(null, { user: 'Bob', title: 'Air Horn', cost: 500 });
  assert.equal(result, null);
});

test('returns null for empty string template', () => {
  const result = formatChatTemplate('', { user: 'Bob', title: 'Air Horn', cost: 500 });
  assert.equal(result, null);
});

test('passes through static text with no placeholders', () => {
  const result = formatChatTemplate('static text', { user: 'Bob', title: 'Air Horn', cost: 500 });
  assert.equal(result, 'static text');
});

test('no double-replacement when user value contains a placeholder pattern', () => {
  // If user is literally "{cost}", the {cost} in the template should still become "999",
  // not trigger a second replacement pass on the substituted user string.
  const result = formatChatTemplate('{user} spent {cost}', {
    user: '{cost}',
    title: 'Test',
    cost: 999,
  });
  // {user} -> "{cost}" (literal string), then {cost} -> "999".
  // The "{cost}" that came from user substitution must NOT be re-substituted.
  assert.equal(result, '{cost} spent 999');
});

test('handles numeric cost correctly', () => {
  const result = formatChatTemplate('Thanks {user}! Cost: {cost} pts', {
    user: 'Alice',
    title: 'SFX',
    cost: 1500,
  });
  assert.equal(result, 'Thanks Alice! Cost: 1500 pts');
});
