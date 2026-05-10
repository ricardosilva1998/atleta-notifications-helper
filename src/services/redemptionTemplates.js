// Pure template formatter — no external deps so it can be unit-tested without env vars.
function formatChatTemplate(template, { user, title, cost }) {
  if (!template) return null;
  // Single-pass regex replacement prevents double-substitution: if user contains
  // "{cost}" as a literal string, it must not be re-processed after substitution.
  const map = { user: String(user), title: String(title), cost: String(cost) };
  return template.replace(/\{(user|title|cost)\}/g, (_, key) => map[key]);
}

module.exports = { formatChatTemplate };
