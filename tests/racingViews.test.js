'use strict';

// The Track Database (src/views/tracks.ejs) and the iRacing page
// (src/views/iracing.ejs) show what the Atleta Racing app, and anyone else,
// posts to the public racing routes. Each page is rendered with EJS and its
// script runs in a vm with a small DOM that parses the HTML it is given the way
// a browser would (elements, attributes, entities). The API answers it reads
// hold hostile values in every field the page shows: none may come out as
// markup (an element or an attribute that runs code), and the page must keep
// working with them. No network, no real browser.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');
const { t, SUPPORTED_LANGS, esc, richFor } = require('../src/i18n');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const read = (page) => fs.readFileSync(path.join(VIEWS, `${page}.ejs`), 'utf8');

// What a hostile value looks like in every place a page puts one.
const HOSTILE = ['<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', "'><script>alert(1)</script>", '" onmouseover="alert(1)'];
const [IMG, SVG, SCRIPT, ATTR] = HOSTILE;

// ── A small DOM ──────────────────────────────────────────────────────────

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', times: '×', middot: '·' };
const decode = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
  if (name[0] === '#') return String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
  return Object.hasOwn(NAMED, name.toLowerCase()) ? NAMED[name.toLowerCase()] : whole;
});
const escapeText = (text) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

class TextNode {
  constructor(data) { this.nodeType = 3; this.data = data; this.parentNode = null; }
  get textContent() { return this.data; }
}

function makeStyle() {
  const style = {};
  Object.defineProperty(style, 'cssText', {
    get() { return this._css || ''; },
    set(text) {
      this._css = String(text);
      for (const part of this._css.split(';')) {
        const colon = part.indexOf(':');
        if (colon > 0) this[camel(part.slice(0, colon).trim())] = part.slice(colon + 1).trim();
      }
    },
  });
  return style;
}

// A canvas 2D context that draws nothing.
const fakeContext = () => new Proxy({}, { get: (target, key) => (key in target ? target[key] : () => {}), set: (target, key, value) => { target[key] = value; return true; } });

class Element {
  constructor(tag, document) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.ownerDocument = document;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.style = makeStyle();
    this.listeners = {};
    this.value = '';
    this.disabled = false;
    if (this.tagName === 'CANVAS') { this.width = 300; this.height = 150; }
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get nextElementSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children;
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  get id() { return this.getAttribute('id') || ''; }
  set id(value) { this.setAttribute('id', value); }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }
  get title() { return this.getAttribute('title') || ''; }
  set title(value) { this.setAttribute('title', value); }
  get classList() {
    const el = this;
    const list = () => el.className.split(/\s+/).filter(Boolean);
    return {
      add: (...names) => { el.className = [...new Set([...list(), ...names])].join(' '); },
      remove: (...names) => { el.className = list().filter((n) => !names.includes(n)).join(' '); },
      contains: (name) => list().includes(name),
      toggle: (name, force) => {
        const on = force === undefined ? !list().includes(name) : !!force;
        if (on) el.classList.add(name); else el.classList.remove(name);
        return on;
      },
    };
  }
  getAttribute(name) {
    const key = String(name).toLowerCase();
    if (key.startsWith('data-')) {
      const value = this.dataset[camel(key.slice(5))];
      return value === undefined ? null : String(value);
    }
    return Object.hasOwn(this.attributes, key) ? this.attributes[key] : null;
  }
  setAttribute(name, value) {
    const key = String(name).toLowerCase();
    const text = String(value);
    if (key.startsWith('data-')) this.dataset[camel(key.slice(5))] = text;
    else this.attributes[key] = text;
    if (key === 'style') this.style.cssText = text;
    if (key === 'value') this.value = text;
    if ((key === 'width' || key === 'height') && this.tagName === 'CANVAS') this[key] = Number(text);
  }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  attributeNames() { return [...Object.keys(this.attributes), ...Object.keys(this.dataset).map((k) => `data-${kebab(k)}`)]; }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  append(...nodes) { for (const node of nodes) this.appendChild(typeof node === 'string' ? new TextNode(node) : node); }
  removeChild(node) { this.childNodes = this.childNodes.filter((n) => n !== node); node.parentNode = null; return node; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) { this.textContent = ''; this.append(...nodes); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(value) {
    for (const node of this.childNodes) node.parentNode = null;
    this.childNodes = [];
    const text = value == null ? '' : String(value);
    if (text) this.appendChild(new TextNode(text));
  }
  get innerHTML() { return this.childNodes.map(serialize).join(''); }
  set innerHTML(html) {
    for (const node of this.childNodes) node.parentNode = null;
    this.childNodes = [];
    parseInto(this, String(html));
  }
  querySelectorAll(selector) { const found = []; walk(this, (el) => { if (matches(el, selector)) found.push(el); }); return found; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    for (let el = this; el && el.nodeType === 1; el = el.parentNode) if (matches(el, selector)) return el;
    return null;
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  dispatch(type) {
    const event = { type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} };
    for (const fn of this.listeners[type] || []) fn.call(this, event);
    if (typeof this[`on${type}`] === 'function') this[`on${type}`].call(this, event);
  }
  click() { this.dispatch('click'); }
  getContext() { return fakeContext(); }
  focus() {}
}

function serialize(node) {
  if (node.nodeType === 3) return escapeText(node.data);
  const tag = node.tagName.toLowerCase();
  const attrs = node.attributeNames().map((name) => ` ${name}="${node.getAttribute(name).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('');
  return VOID.has(tag) ? `<${tag}${attrs}>` : `<${tag}${attrs}>${node.childNodes.map(serialize).join('')}</${tag}>`;
}

function walk(root, visit) {
  for (const child of root.childNodes) {
    if (child.nodeType !== 1) continue;
    visit(child);
    walk(child, visit);
  }
}

// HTML into elements, as a browser's parser builds them for these pages.
function parseInto(parent, html) {
  const doc = parent.ownerDocument;
  const stack = [parent];
  const top = () => stack[stack.length - 1];
  const addText = (text) => { if (text) top().appendChild(new TextNode(decode(text))); };
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { addText(html.slice(i)); break; }
    addText(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt);
      const name = html.slice(lt + 2, end === -1 ? html.length : end).trim().toUpperCase();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tagName === name) { stack.length = k; break; }
      }
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const open = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt, lt + 64));
    if (!open) { addText('<'); i = lt + 1; continue; }
    const el = new Element(open[1], doc);
    let j = lt + open[0].length;
    let selfClosing = false;
    while (j < html.length) {
      while (j < html.length && /\s/.test(html[j])) j++;
      if (html[j] === '>') { j++; break; }
      if (html[j] === '/' && html[j + 1] === '>') { selfClosing = true; j += 2; break; }
      const name = /^[^\s"'>/=]+/.exec(html.slice(j, j + 200));
      if (!name) { j++; continue; }
      j += name[0].length;
      while (j < html.length && /\s/.test(html[j])) j++;
      let value = '';
      if (html[j] === '=') {
        j++;
        while (j < html.length && /\s/.test(html[j])) j++;
        const quote = html[j];
        if (quote === '"' || quote === "'") {
          const end = html.indexOf(quote, j + 1);
          value = html.slice(j + 1, end === -1 ? html.length : end);
          j = end === -1 ? html.length : end + 1;
        } else {
          value = /^[^\s>]*/.exec(html.slice(j))[0];
          j += value.length;
        }
      }
      el.setAttribute(name[0], decode(value));
    }
    top().appendChild(el);
    const tag = el.tagName.toLowerCase();
    if (RAW_TEXT.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, j);
      const text = html.slice(j, close === -1 ? html.length : close);
      if (text) el.appendChild(new TextNode(text));
      i = close === -1 ? html.length : html.indexOf('>', close) + 1;
      continue;
    }
    if (!selfClosing && !VOID.has(tag)) stack.push(el);
    i = j;
  }
}

// Selectors: tag, #id, .class, [attr], [attr="value"], and the descendant combinator.
function compound(text) {
  const parts = { tag: null, id: null, classes: [], attrs: [] };
  const re = /([a-zA-Z][a-zA-Z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    assert.equal(m.index, at, `selector ${text}`);
    at = re.lastIndex;
    if (m[1]) parts.tag = m[1].toUpperCase();
    else if (m[2]) parts.id = m[2];
    else if (m[3]) parts.classes.push(m[3]);
    else parts.attrs.push({ name: m[4], value: m[5] ?? m[6] ?? m[7] });
  }
  assert.equal(at, text.length, `selector ${text}`);
  return parts;
}
function matchesCompound(el, c) {
  if (el.nodeType !== 1) return false;
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  const classes = el.className.split(/\s+/);
  if (c.classes.some((name) => !classes.includes(name))) return false;
  return c.attrs.every((a) => { const v = el.getAttribute(a.name); return v !== null && (a.value === undefined || v === a.value); });
}
function matches(el, selector) {
  return selector.split(',').some((one) => {
    const chain = one.trim().split(/\s+/).map(compound);
    if (!matchesCompound(el, chain[chain.length - 1])) return false;
    let k = chain.length - 2;
    for (let up = el.parentNode; k >= 0 && up && up.nodeType === 1; up = up.parentNode) if (matchesCompound(up, chain[k])) k--;
    return k < 0;
  });
}

function makeDocument(html) {
  const document = { referrer: '' };
  const root = new Element('#root', document);
  parseInto(root, html);
  Object.assign(document, {
    root,
    getElementById: (id) => root.querySelectorAll(`#${id}`)[0] || null,
    querySelector: (selector) => root.querySelector(selector),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    createElement: (tag) => new Element(tag, document),
    createTextNode: (text) => new TextNode(String(text)),
  });
  document.body = root.querySelector('body') || root;
  return document;
}

// ── Running a page ───────────────────────────────────────────────────────

const inlineScripts = (html) => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);

function render(page, locals = {}) {
  const translate = (key, params) => t('en', key, params);
  return ejs.render(read(page), {
    t: translate, esc, rich: richFor(translate), lang: 'en', SUPPORTED_LANGS, currentPath: '/', isAdmin: false,
    notifications: [], unreadNotifCount: 0, racingUser: null, streamer: null, features: { youtube: true }, csrfToken: 'tok', streamerTier: 'free',
    ...locals,
  }, { filename: path.join(VIEWS, `${page}.ejs`), views: [VIEWS] });
}

// Runs the page's own script (the inline one holding `marker`) on its markup.
// api(url, options) answers each fetch: a value is sent as JSON, an Error rejects.
function runPage(html, marker, { api, pathname = '/', storage = {} }) {
  const document = makeDocument(html);
  const timers = [];
  const intervals = [];
  const errors = [];
  const store = new Map(Object.entries(storage));
  const fetched = [];
  const sandbox = {
    document,
    console: { log() {}, warn() {}, error: (...args) => errors.push(args.map(String).join(' ')) },
    location: { pathname, href: `http://localhost${pathname}` },
    history: { pushState() {}, back() {}, length: 1 },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    navigator: { clipboard: { writeText: async () => {} } },
    addEventListener() {},
    fetch: (url, options = {}) => {
      fetched.push({ url: String(url), options });
      const answer = api(String(url), options);
      if (answer instanceof Error) return Promise.reject(answer);
      const body = JSON.parse(JSON.stringify(answer === undefined ? null : answer));
      return Promise.resolve({ ok: true, status: 200, json: async () => body });
    },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {},
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    clearInterval() {},
    requestAnimationFrame: (fn) => setImmediate(fn),
    FileReader: class {
      readAsText(file) { this.result = file.text; setImmediate(() => this.onload && this.onload()); }
      readAsDataURL(file) { this.result = `data:application/octet-stream;base64,${Buffer.from(file.text || '').toString('base64')}`; setImmediate(() => this.onload && this.onload()); }
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const script = inlineScripts(html).find((s) => s.includes(marker));
  assert.ok(script, `the page script with ${marker}`);
  vm.runInContext(script, context, { filename: marker });
  return {
    document, context, errors, fetched, store,
    runTimers() { const due = timers.splice(0); for (const fn of due) fn(); },
    // Each repeating timer once, as if its interval had passed.
    runIntervals() { for (const fn of intervals) fn(); },
  };
}

const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve)); };

// Nothing under root that came from data may run code: no such element, no
// attribute carrying the hostile code except the inert ones (data-*, title, value).
function assertInert(root, where) {
  assert.ok(root, `${where} exists`);
  const found = [];
  walk(root, (el) => {
    if (['IMG', 'SVG', 'SCRIPT', 'IFRAME', 'OBJECT', 'EMBED'].includes(el.tagName)) found.push(`<${el.tagName.toLowerCase()}>`);
    for (const name of el.attributeNames()) {
      if (/^(data-|title$|value$)/.test(name)) continue;
      if (/alert\(/.test(el.getAttribute(name))) found.push(`${name}="${el.getAttribute(name)}"`);
    }
  });
  assert.deepEqual(found, [], `${where}: markup made from the data`);
}

// Unhandled rejections inside the page scripts fail the test that caused them.
const rejections = [];
process.on('unhandledRejection', (reason) => rejections.push(String((reason && reason.stack) || reason)));

// ── tracks.ejs ───────────────────────────────────────────────────────────

const TRACK = 'Hostile Ring';
const BRIDGE_ID = '3f1c2a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f';
const outline = Array.from({ length: 60 }, (_, i) => ({ x: Math.cos(i / 10), y: Math.sin(i / 10) }));

function tracksApi({ live = true } = {}) {
  return (url, options) => {
    if (url === '/api/track-maps') {
      return [
        { track_name: TRACK, point_count: 500, track_length: IMG, track_turns: SVG, track_country: SCRIPT, track_city: ATTR },
        { track_name: SVG, point_count: 500, track_length: '5.79 km', track_turns: 21, track_country: 'Belgium', track_city: null },
      ];
    }
    if (url === '/api/track-stats' && (!options.method || options.method === 'GET')) {
      return [
        { track_name: TRACK, car_class: 'GT3', race_type: 'VRS Sprint', avg_lap_time: 98.512, avg_pit_time: '31.5', avg_qualify_time: '97.25', est_laps: '24.4', avg_sof: '2210', race_count: IMG, avg_drivers: SVG, top_car: SCRIPT },
        { track_name: TRACK, car_class: SVG, race_type: ATTR, avg_lap_time: IMG, avg_pit_time: SVG, avg_qualify_time: SCRIPT, est_laps: ATTR, avg_sof: IMG, race_count: SVG, avg_drivers: SCRIPT, top_car: IMG },
        { track_name: SVG, car_class: 'GT3', race_type: 'VRS Sprint', avg_lap_time: 90, avg_pit_time: 0, avg_qualify_time: 0, est_laps: 0, avg_sof: 0, race_count: '3', avg_drivers: 10, top_car: null },
      ];
    }
    if (url === '/api/track-stats') return { ok: false, error: IMG };
    if (url === '/api/live-session') {
      return live ? { trackName: TRACK, eventType: IMG, raceType: SVG, classes: [SCRIPT, ATTR], driversCount: IMG, totalMinutes: SVG, timeRemain: SCRIPT } : null;
    }
    if (url.startsWith('/api/track-map/')) return { trackData: outline };
    if (url.startsWith('/api/sessions/')) {
      return [
        { id: 7, session_type: 'race', race_type: IMG, car_name: SVG, car_class: 'GT3', best_lap_time: SCRIPT, actual_laps: 0, lap_count: IMG, created_at: '2026-10-01 12:00:00', bridge_id: ATTR },
        { id: 8, session_type: 'practice', race_type: null, car_name: '', car_class: SCRIPT, best_lap_time: 95.5, actual_laps: 12, lap_count: 12, created_at: '2026-10-02 12:00:00', bridge_id: BRIDGE_ID },
      ];
    }
    if (url.startsWith('/api/session/7')) {
      return {
        session: { iracing_name: IMG, conditions: JSON.stringify({ airTemp: SVG, skies: SCRIPT }), sof: IMG, finish_position: SVG, irating_change: SCRIPT },
        laps: [
          { lap_number: IMG, lap_time: 95.5, is_valid: 1, is_pit_lap: 0, fuel_used: '2.5', track_temp: SVG },
          { lap_number: 2, lap_time: 96.75, is_valid: 1, is_pit_lap: 0, fuel_used: IMG, track_temp: 30.4 },
          { lap_number: SVG, lap_time: IMG, is_valid: 0, is_pit_lap: 1, fuel_used: SCRIPT, track_temp: ATTR },
        ],
      };
    }
    if (url.startsWith('/api/session/8')) {
      return { session: { iracing_name: 'Driver', sof: 2150, finish_position: 3, irating_change: -12 }, laps: [{ lap_number: 1, lap_time: 95.5, is_valid: 1, fuel_used: 2.4, track_temp: 30 }] };
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

async function openTrack(options = {}) {
  const html = render('tracks', { racingUser: { id: 1, username: 'racer', bridge_id: options.bridgeId || BRIDGE_ID } });
  const page = runPage(html, 'KNOWN_IRACING_TRACKS', { api: options.api || tracksApi(options), pathname: `/tracks/${encodeURIComponent(TRACK)}` });
  await settle();
  page.runIntervals(); // the live-session poll, 10 s later
  await settle();
  return page;
}

describe('tracks.ejs: the page script builds no markup from raw data', () => {
  const script = inlineScripts(render('tracks', { racingUser: null })).find((s) => s.includes('KNOWN_IRACING_TRACKS'));

  test('no raw track, session, lap or live-session value in its HTML strings', () => {
    for (const piece of [/\$\{track\./, /' \+ s\./, /' \+ l\./, /' \+ type\b/, /' \+ classes\b/, /' \+ drivers\b/]) {
      assert.ok(!piece.test(script), `the page script still has ${piece}`);
    }
  });

  test('its escapeHtml() escapes quotes too (it is used inside attributes)', () => {
    const helper = /const _HTML_ESC = [^\n]*\n\s*function escapeHtml\(s\) \{[^\n]*\}/.exec(script);
    assert.ok(helper, 'escapeHtml is defined in the page script');
    const context = vm.createContext({});
    vm.runInContext(`${helper[0]}; this.escapeHtml = escapeHtml;`, context);
    assert.equal(context.escapeHtml(`<a href="x" title='y'>&`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;');
    assert.equal(context.escapeHtml(null), '');
    assert.equal(context.escapeHtml(42), '42');
  });
});

describe('tracks.ejs with hostile values in every field', () => {
  test('the track list and the track header', async () => {
    rejections.length = 0;
    const page = await openTrack();
    const $ = (id) => page.document.getElementById(id);
    for (const id of ['tracks-grid', 'tracks-list-body', 'detail-stats', 'detail-location', 'class-tabs', 'class-stats-content']) assertInert($(id), id);
    // The header: the length is text, the turns and counts are numbers or "--".
    const stats = $('detail-stats').textContent;
    assert.ok(stats.includes(IMG), 'the length is shown as text');
    assert.ok(!stats.includes(SVG), 'turns that are not a number are not shown');
    assert.match(stats, /--Turns/);
    assert.match(stats, /0Races/, 'races that are not numbers count as 0');
    assert.equal($('detail-location').textContent, `${ATTR}, ${SCRIPT}`);
    // The list: the hostile track name and its details are text.
    assert.ok($('tracks-grid').textContent.includes(SVG));
    assert.ok($('tracks-list-body').textContent.includes(SVG));
    assert.deepEqual(rejections, []);
  });

  test('race statistics, and a class tab named with markup', async () => {
    rejections.length = 0;
    const page = await openTrack();
    const $ = (id) => page.document.getElementById(id);
    const table = $('class-stats-content').textContent;
    assert.ok(table.includes('31.5s'), 'an average pit time stored as text is still shown');
    assert.ok(table.includes(SCRIPT), 'the top car is text');
    const tabs = $('class-tabs').querySelectorAll('.class-tab');
    const hostileTab = tabs.find((tab) => tab.dataset.class === SVG);
    assert.ok(hostileTab, 'the class is carried as data');
    assert.equal(hostileTab.textContent, SVG);
    hostileTab.click();
    await settle();
    assertInert($('class-stats-content'), 'class-stats-content (hostile class)');
    assert.ok($('class-stats-content').textContent.includes(ATTR), 'the race type is text');
    assert.deepEqual(rejections, []);
  });

  test('the session list and a session\'s laps', async () => {
    rejections.length = 0;
    const page = await openTrack();
    const $ = (id) => page.document.getElementById(id);
    assertInert($('race-sessions'), 'race-sessions');
    assertInert($('practice-sessions'), 'practice-sessions');
    const raceRow = $('race-sessions').querySelector('.session-row[data-session-id]');
    assert.equal(raceRow.dataset.bridgeId, ATTR, 'the bridge id is carried as data');
    assert.ok(raceRow.textContent.includes(SVG) && raceRow.textContent.includes(IMG), 'car and race type are text');
    raceRow.click();
    await settle();
    const detail = $(raceRow.dataset.detailId);
    assertInert(detail, 'session detail');
    const text = detail.textContent;
    assert.ok(text.includes(`Driver: ${IMG}`));
    assert.ok(text.includes('2.5L'), 'fuel stored as text is still shown');
    assert.ok(text.includes('Finished: P--') && text.includes('SOF: --') && text.includes('iR: --'), text);
    assert.ok(text.includes(SCRIPT), 'the sky is text');
    assert.ok(!text.includes(SVG) && !text.includes('NaN'), 'values that are not numbers are not shown');
    assert.ok(!text.includes('Failed to load laps'));
    assert.equal(detail.querySelectorAll('tr').length, 4, 'a header and three laps');
    assert.deepEqual(rejections, []);
  });

  test('the live banner', async () => {
    rejections.length = 0;
    const page = await openTrack();
    const banner = page.document.getElementById('detail-live-info');
    assertInert(banner, 'detail-live-info');
    assert.equal(banner.style.display, 'flex');
    const text = banner.textContent;
    assert.ok(text.startsWith('LIVE'));
    for (const value of [SVG, SCRIPT, ATTR]) assert.ok(text.includes(value), `${value} is text`);
    assert.ok(text.includes('-- drivers'));
    assert.ok(!text.includes('min left'), 'a time that is not a number is not shown');
    assert.deepEqual(rejections, []);
  });

  test('a live session whose classes are not a list', async () => {
    rejections.length = 0;
    const api = tracksApi();
    const page = await openTrack({ api: (url, options) => (url === '/api/live-session' ? { trackName: TRACK, eventType: 'Race', classes: IMG, driversCount: 20, timeRemain: 600 } : api(url, options)) });
    const banner = page.document.getElementById('detail-live-info');
    assertInert(banner, 'detail-live-info');
    assert.ok(banner.textContent.includes('20 drivers') && banner.textContent.includes('10 min left'));
    assert.ok(!banner.textContent.includes(IMG));
    assert.deepEqual(rejections, []);
  });

  test('the import preview and its messages', async () => {
    rejections.length = 0;
    const page = await openTrack({ live: false });
    const $ = (id) => page.document.getElementById(id);
    page.context.handleImportFile({ name: 'race.json', size: 100, text: JSON.stringify({ avgLapTime: 92.5, avgPitTime: SVG, avgSOF: IMG, driverCount: SCRIPT, estLaps: ATTR, topCar: IMG }) });
    await settle();
    assertInert($('import-confirm-grid'), 'import-confirm-grid');
    const preview = $('import-confirm-grid').textContent;
    assert.ok(preview.includes(IMG), 'the top car is text');
    assert.ok(preview.includes('1:32.500'));
    page.context.saveImport();
    await settle();
    assertInert($('import-message'), 'import-message');
    assert.equal($('import-message').textContent, `Error: ${IMG}`);
    const api = tracksApi();
    const failing = await openTrack({ live: false, api: (url, options) => (url === '/api/track-stats' && options.method === 'POST' ? new Error(SVG) : api(url, options)) });
    failing.context.handleImportFile({ name: 'race.json', size: 100, text: JSON.stringify({ avgLapTime: 92.5 }) });
    await settle();
    failing.context.saveImport();
    await settle();
    assertInert(failing.document.getElementById('import-message'), 'import-message (request failed)');
    assert.equal(failing.document.getElementById('import-message').textContent, `Request failed: ${SVG}`);
    assert.deepEqual(rejections, []);
  });

  test('the logged-in racer\'s own bridge id reaches the script as data', async () => {
    const odd = `</script><script>alert(1)</script>'\\`;
    const html = render('tracks', { racingUser: { id: 1, username: 'racer', bridge_id: odd } });
    const script = inlineScripts(html).find((s) => s.includes('KNOWN_IRACING_TRACKS'));
    assert.ok(script, 'the page script is still one script');
    assert.doesNotThrow(() => new vm.Script(script), 'the script still parses');
    const page = await openTrack({ bridgeId: odd });
    const sessions = page.fetched.find((f) => f.url.startsWith('/api/sessions/'));
    assert.ok(sessions.url.endsWith(`?bridge_id=${encodeURIComponent(odd)}`), sessions.url);
  });
});

// ── iracing.ejs ──────────────────────────────────────────────────────────

const USERS = [
  { bridge_id: ATTR, iracing_name: IMG, total_bytes: 2048, log_batches: 3, last_seen: '2026-10-14 09:00:00', first_seen: '2026-10-01 09:00:00', pending_reports: 1, approved_reports: 0, dismissed_reports: 0 },
  { bridge_id: "x'); alert(1); ('", iracing_name: null, total_bytes: 0, log_batches: 1, last_seen: '2026-10-13 09:00:00', first_seen: '2026-10-13 09:00:00', pending_reports: 0, approved_reports: 0, dismissed_reports: 0 },
];

function iracingApi(url) {
  if (url === '/api/track-maps') return [{ track_name: SVG, point_count: IMG }, { track_name: '49.33_8.57', point_count: 500 }];
  if (url.startsWith('/api/track-map/')) return { trackData: outline };
  if (url === '/api/bridge-users') return { users: USERS };
  if (url.startsWith('/api/bridge-logs/')) return { logs: [{ lines: `[Telemetry] ${IMG}\n[ERR] ${SVG}\n` }] };
  if (url.startsWith('/api/bridge-bug-reports')) return { reports: [{ id: 5, status: 'pending', error_pattern: IMG, explanation: SVG, suggested_fix: SCRIPT, created_at: '2026-10-01 10:00:00' }] };
  if (url.startsWith('/api/track-stats/')) {
    return [
      { car_class: 'GT3', race_type: IMG, avg_lap_time: 98.5, avg_pit_time: '31.5', avg_qualify_time: SVG, est_laps: '24.5', avg_sof: SCRIPT, race_count: ATTR, avg_drivers: IMG },
      { car_class: 'GT3', race_type: 'vrs_sprint', avg_lap_time: 97.25, avg_pit_time: 30, avg_qualify_time: 96.5, est_laps: 20, avg_sof: 2100, race_count: 4, avg_drivers: 18 },
    ];
  }
  throw new Error(`unexpected fetch ${url}`);
}

async function openIracing() {
  const html = render('iracing', { isAdmin: true });
  const page = runPage(html, 'switchIRacingTab', { api: iracingApi, storage: { bridgeId: BRIDGE_ID } });
  await settle();
  page.runTimers();
  await settle();
  return page;
}

describe('iracing.ejs with hostile values in every field', () => {
  test('the Bridge Users panel builds its rows from data, never inline code', async () => {
    rejections.length = 0;
    const page = await openIracing();
    const panel = page.document.getElementById('bridge-users-container');
    assertInert(panel, 'bridge-users-container');
    assert.ok(panel.textContent.includes(IMG), 'the iRacing name is text');
    assert.ok(panel.textContent.includes(ATTR), 'the bridge id is text');
    const buttons = panel.querySelectorAll('button');
    assert.equal(buttons.length, 2);
    for (const [i, button] of buttons.entries()) {
      assert.equal(button.getAttribute('onclick'), null, 'no inline handler');
      assert.equal(button.dataset.bridgeId, USERS[i].bridge_id, 'the id rides in data-bridge-id');
    }
    const withTitle = panel.querySelectorAll('span').find((span) => span.getAttribute('title') === ATTR);
    assert.ok(withTitle, 'the full id is the title');
    buttons[1].click();
    assert.equal(page.document.getElementById('bridge-id-input').value, USERS[1].bridge_id);
    assert.equal(page.store.get('bridgeId'), USERS[1].bridge_id);
    assert.equal(buttons[1].textContent, 'Connected!');
    assert.deepEqual(rejections, []);
  });

  test('the track statistics page with a race type it does not know', async () => {
    rejections.length = 0;
    const page = await openIracing();
    await page.context.showTrackStatsPage('Spa');
    const content = page.document.getElementById('track-stats-page-content');
    assertInert(content, 'track-stats-page-content');
    const text = content.textContent;
    assert.ok(!text.includes('Failed to load stats'), text.slice(0, 200));
    assert.ok(text.includes(IMG), 'the race type is text');
    assert.ok(text.includes('31.5s') && text.includes('24.50'), 'numbers stored as text are still shown');
    assert.ok(text.includes('VRS Sprint'));
    assert.deepEqual(rejections, []);
  });

  test('the track grid, the logs and the bug reports', async () => {
    rejections.length = 0;
    const page = await openIracing();
    for (const id of ['track-db-grid', 'bridge-logs-container', 'bug-reports-container']) assertInert(page.document.getElementById(id), id);
    const grid = page.document.getElementById('track-db-grid').textContent;
    assert.ok(grid.includes(SVG) && grid.includes('-- pts'), grid.slice(0, 200));
    assert.ok(page.document.getElementById('bridge-logs-container').textContent.includes(IMG));
    assert.ok(page.document.getElementById('bug-reports-container').textContent.includes(SCRIPT));
    assert.deepEqual(rejections, []);
  });

  test('its escapeHtml() escapes quotes too', () => {
    const script = inlineScripts(render('iracing', { isAdmin: true })).find((s) => s.includes('switchIRacingTab'));
    const helper = /function escapeHtml\(str\) \{[\s\S]*?\n\}/.exec(script);
    assert.ok(helper);
    const context = vm.createContext({});
    vm.runInContext(`${helper[0]}; this.escapeHtml = escapeHtml;`, context);
    assert.equal(context.escapeHtml(`<b title="x">'&`), '&lt;b title=&quot;x&quot;&gt;&#39;&amp;');
    assert.equal(context.escapeHtml(undefined), '');
    assert.equal(context.escapeHtml(7), '7');
  });
});
