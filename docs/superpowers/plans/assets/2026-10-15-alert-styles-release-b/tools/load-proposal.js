// Loads the proposal's core and family files in a sandbox and returns its looks, families and sound names.
const fs = require('fs'), path = require('path'), vm = require('vm');
module.exports = function loadProposal(partsDir) {
  const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : stub), apply: () => stub, construct: () => stub });
  const sandbox = { console, window: {}, document: stub, navigator: {}, setTimeout() {}, clearTimeout() {}, requestAnimationFrame() {}, performance: { now: () => 0 } };
  sandbox.window = sandbox; vm.createContext(sandbox);
  const files = [path.join(partsDir, '90-core.js')].concat(fs.readdirSync(path.join(partsDir, 'fam')).filter((f) => f.endsWith('.js')).sort().map((f) => path.join(partsDir, 'fam', f)));
  // 90-core.js opens the page's one function scope (99-ui.js closes it): close it here after the families,
  // handing out what the looks registered.
  const src = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n;\n')
    + '\n;window.__out = { P: P, FAMS: FAMS, SOUND_NAMES: SOUND_NAMES, SOUNDS: SOUNDS };\n})();';
  vm.runInContext(src, sandbox, { filename: 'proposal.js' });
  return sandbox.__out;
};
