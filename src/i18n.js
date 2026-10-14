const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, 'locales');
const translations = {};
const SUPPORTED_LANGS = ['en', 'pt', 'es', 'fr', 'de', 'zh', 'ja'];

for (const lang of SUPPORTED_LANGS) {
  const filePath = path.join(localesDir, `${lang}.json`);
  if (fs.existsSync(filePath)) {
    translations[lang] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
}

function t(lang, key, params = {}) {
  const str = translations[lang]?.[key] || translations['en']?.[key] || key;
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => params[k] ?? '');
}

// The language an Accept-Language header asks for first among the supported ones
// ("pt-BR,pt;q=0.9,en;q=0.8" -> 'pt'; a region is ignored, `q=0` means "not wanted"),
// or null when it names none of them. A visitor with no `lang` cookie yet (the public
// tip page is mostly opened by people who have never been on the site) gets this
// language instead of English.
function fromAcceptLanguage(header) {
  if (typeof header !== 'string' || header === '') return null;
  const ranges = header.split(',').slice(0, 20).map((part, order) => {
    const [tag, ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => /^q=/i.test(p));
    const weight = q ? parseFloat(q.slice(2)) : 1;
    return { language: tag.trim().toLowerCase().split('-')[0], weight: Number.isFinite(weight) ? weight : 0, order };
  }).filter((r) => r.language && r.weight > 0);
  ranges.sort((a, b) => b.weight - a.weight || a.order - b.order);
  const hit = ranges.find((r) => SUPPORTED_LANGS.includes(r.language));
  return hit ? hit.language : null;
}

module.exports = { t, SUPPORTED_LANGS, fromAcceptLanguage };
