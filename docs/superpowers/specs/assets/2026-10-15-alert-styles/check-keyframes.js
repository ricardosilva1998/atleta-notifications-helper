// Every animation name used in the page (CSS animation: and the looks' in/out) must have @keyframes.
const fs = require('fs');
const h = fs.readFileSync(process.argv[2], 'utf8');
const defined = new Set([...h.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]));
const used = new Set();
for (const m of h.matchAll(/animation:([^;}]+)[;}]/g)) {
  for (const part of m[1].split(/,(?![^(]*\))/)) {
    const name = part.trim().split(/\s+/)[0];
    if (name && !name.startsWith('var(') && name !== 'none') used.add(name);
  }
}
for (const m of h.matchAll(/\b(?:in|out):\s*'([A-Za-z][\w-]*)'/g)) used.add(m[1]);
const missing = [...used].filter(n => !defined.has(n));
if (missing.length) { console.error('Missing @keyframes:', missing.join(', ')); process.exit(1); }
console.log('keyframes ok:', defined.size, 'defined,', used.size, 'used');
