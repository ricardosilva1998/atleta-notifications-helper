'use strict';

// The real public/js/csrf.js in a vm context with a small stand-in for the
// browser: a page at https://atleta.example, recorders for fetch() and
// XMLHttpRequest, and forms that record how they were sent. What is checked is
// which requests get the page's CSRF token (src/csrf.js) and which do not.
// No network, no real browser.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CSRF_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'csrf.js'), 'utf8');
const PAGE = 'https://atleta.example/dashboard/overlay';
const TOKEN = 'synthetic-page-token';

// A page with the script loaded, the way src/views/csrf.ejs loads it. With
// viaLoader, document.currentScript is null, as when a script loader runs it.
function loadPage({ token = TOKEN, viaLoader = false } = {}) {
  const fetched = [];
  const sentForms = [];
  const xhrs = [];
  const listeners = [];

  class HTMLFormElement {
    constructor(attributes = {}) {
      this.tagName = 'FORM';
      this.attributes = attributes;
      this.fields = [];
    }
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
    querySelector(selector) {
      assert.equal(selector, 'input[name="_csrf"]');
      return this.fields.find((field) => field.name === '_csrf') || null;
    }
    appendChild(field) { this.fields.push(field); return field; }
    submit() { sentForms.push({ form: this, fields: this.fields.map((f) => [f.name, f.value]) }); }
    // A button press or the Enter key: the submit event, then the form is sent.
    pressSubmit(submitter) {
      for (const listener of listeners) listener({ target: this, submitter });
      sentForms.push({ form: this, fields: this.fields.map((f) => [f.name, f.value]) });
    }
  }

  class XMLHttpRequest {
    constructor() { this.headers = {}; xhrs.push(this); }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(body) { this.body = body; }
  }

  const window = {
    location: { href: PAGE, origin: new URL(PAGE).origin },
    fetch(input, init) { fetched.push({ input, init }); return Promise.resolve({ ok: true }); },
    Headers, Request, URL, HTMLFormElement, XMLHttpRequest,
    document: {
      currentScript: viaLoader ? null : { getAttribute: (name) => (name === 'data-csrf-token' ? token : null) },
      querySelector: (selector) => (selector === 'script[data-csrf-token]' ? { getAttribute: () => token } : null),
      addEventListener(type, listener, capture) {
        assert.equal(type, 'submit');
        assert.equal(capture, true, 'it listens before the page\'s own submit handlers');
        listeners.push(listener);
      },
      createElement: (tag) => ({ tagName: tag.toUpperCase(), type: '', name: '', value: '' }),
    },
  };
  window.window = window;
  const nativeFetch = window.fetch;
  vm.runInNewContext(CSRF_JS, window);
  const headersOf = (call) => new Headers(call.init && call.init.headers);
  return { window, fetched, sentForms, xhrs, nativeFetch, headersOf, HTMLFormElement };
}

describe('fetch()', () => {
  test('a POST to this site gets the X-CSRF-Token header, whatever case its method is in', async () => {
    const page = loadPage();
    await page.window.fetch('/dashboard/overlay/test/follow', { method: 'POST' });
    await page.window.fetch('/dashboard/chatbot', { method: 'post', body: 'a=1' });
    await page.window.fetch('https://atleta.example/dashboard/redemptions/3', { method: 'PATCH' });
    for (const call of page.fetched) assert.equal(page.headersOf(call).get('X-CSRF-Token'), TOKEN, String(call.input));
  });

  test('PUT and DELETE get it too', async () => {
    const page = loadPage();
    await page.window.fetch('/dashboard/api/vtuber/select', { method: 'PUT' });
    await page.window.fetch('/dashboard/account/avatar', { method: 'DELETE' });
    assert.deepEqual(page.fetched.map((call) => page.headersOf(call).get('X-CSRF-Token')), [TOKEN, TOKEN]);
  });

  test('the page\'s own headers are kept, as an object, a Headers or a list of pairs', async () => {
    const page = loadPage();
    await page.window.fetch('/a', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    await page.window.fetch('/b', { method: 'POST', headers: new Headers({ 'Content-Type': 'application/octet-stream' }) });
    await page.window.fetch('/c', { method: 'POST', headers: [['Content-Type', 'text/plain']] });
    assert.deepEqual(page.fetched.map((call) => [page.headersOf(call).get('Content-Type'), page.headersOf(call).get('X-CSRF-Token')]),
      [['application/json', TOKEN], ['application/octet-stream', TOKEN], ['text/plain', TOKEN]]);
  });

  test('a raw upload\'s body goes as it is, with the header', async () => {
    const page = loadPage();
    const file = new Uint8Array([1, 2, 3]);
    const signal = new AbortController().signal;
    await page.window.fetch('/dashboard/sponsors/upload?ext=png', { method: 'POST', body: file, signal });
    const [call] = page.fetched;
    assert.equal(call.init.body, file);
    assert.equal(call.init.signal, signal);
    assert.equal(page.headersOf(call).get('X-CSRF-Token'), TOKEN);
  });

  test('a Request object gets it too, with its own headers kept', async () => {
    const page = loadPage();
    await page.window.fetch(new Request('https://atleta.example/x', { method: 'POST', headers: { 'X-Kind': 'k' } }));
    const headers = page.headersOf(page.fetched[0]);
    assert.equal(headers.get('X-CSRF-Token'), TOKEN);
    assert.equal(headers.get('X-Kind'), 'k');
  });

  test('a GET, and any request to another site, goes without it', async () => {
    const page = loadPage();
    await page.window.fetch('/dashboard/sponsors/list');
    await page.window.fetch('/api/track-stats', { method: 'GET' });
    await page.window.fetch('https://api.elsewhere.example/v1/thing', { method: 'POST' });
    await page.window.fetch('//elsewhere.example/thing', { method: 'POST' });
    for (const call of page.fetched) assert.equal(page.headersOf(call).get('X-CSRF-Token'), null, String(call.input));
    assert.equal(page.fetched[0].init, undefined, 'a GET is passed on untouched');
  });

  test('a token the page set itself is not replaced', async () => {
    const page = loadPage();
    await page.window.fetch('/a', { method: 'POST', headers: { 'X-CSRF-Token': 'chosen' } });
    assert.equal(page.headersOf(page.fetched[0]).get('X-CSRF-Token'), 'chosen');
  });
});

describe('XMLHttpRequest', () => {
  test('a POST to this site gets the header; a GET or another site does not', () => {
    const page = loadPage();
    const send = (method, url) => { const xhr = new page.window.XMLHttpRequest(); xhr.open(method, url); xhr.send('x'); return xhr; };
    assert.equal(send('POST', '/dashboard/report').headers['X-CSRF-Token'], TOKEN);
    assert.equal(send('delete', '/dashboard/x').headers['X-CSRF-Token'], TOKEN);
    assert.equal(send('GET', '/dashboard/x').headers['X-CSRF-Token'], undefined);
    assert.equal(send('POST', 'https://elsewhere.example/x').headers['X-CSRF-Token'], undefined);
  });
});

describe('forms', () => {
  const fieldsOf = (sent) => sent.fields;

  test('a POST form to this site is sent with a hidden _csrf field', () => {
    const page = loadPage();
    new page.HTMLFormElement({ method: 'POST', action: '/dashboard/overlay' }).pressSubmit();
    new page.HTMLFormElement({ method: 'post', action: 'https://atleta.example/racing/auth/login' }).pressSubmit();
    new page.HTMLFormElement({ method: 'post' }).pressSubmit(); // no action: posts to the page itself
    for (const sent of page.sentForms) assert.deepEqual(fieldsOf(sent), [['_csrf', TOKEN]]);
  });

  test('sent twice, it still has one field', () => {
    const page = loadPage();
    const form = new page.HTMLFormElement({ method: 'POST', action: '/set-language' });
    form.pressSubmit();
    form.pressSubmit();
    assert.deepEqual(fieldsOf(page.sentForms[1]), [['_csrf', TOKEN]]);
  });

  test('a form sent by a script with form.submit() (no submit event) gets it too', () => {
    const page = loadPage();
    new page.HTMLFormElement({ method: 'POST', action: '/set-language' }).submit();
    assert.deepEqual(fieldsOf(page.sentForms[0]), [['_csrf', TOKEN]]);
  });

  test('a GET form, or a form to another site, is sent without it', () => {
    const page = loadPage();
    new page.HTMLFormElement({ action: '/tracks' }).pressSubmit();
    new page.HTMLFormElement({ method: 'get', action: '/tracks' }).submit();
    new page.HTMLFormElement({ method: 'POST', action: 'https://www.paypal.example/checkout' }).pressSubmit();
    for (const sent of page.sentForms) assert.deepEqual(fieldsOf(sent), []);
  });

  test('a button\'s formmethod and formaction count', () => {
    const page = loadPage();
    const button = (attributes) => ({ getAttribute: (name) => (name in attributes ? attributes[name] : null) });
    new page.HTMLFormElement({ action: '/x' }).pressSubmit(button({ formmethod: 'post' }));
    new page.HTMLFormElement({ method: 'POST', action: '/x' }).pressSubmit(button({ formaction: 'https://elsewhere.example/x' }));
    assert.deepEqual(page.sentForms.map(fieldsOf), [[['_csrf', TOKEN]], []]);
  });
});

describe('loaded by a script loader (no document.currentScript)', () => {
  test('it finds its tag by the attribute and still sends the token', async () => {
    const page = loadPage({ viaLoader: true });
    await page.window.fetch('/dashboard/chatbot', { method: 'POST' });
    assert.equal(page.headersOf(page.fetched[0]).get('X-CSRF-Token'), TOKEN);
  });
});

describe('a page without a token (nobody is logged in)', () => {
  test('changes nothing: fetch, forms and XMLHttpRequest are left as they are', () => {
    const page = loadPage({ token: '' });
    assert.equal(page.window.fetch, page.nativeFetch);
    new page.HTMLFormElement({ method: 'POST', action: '/racing/auth/login' }).submit();
    assert.deepEqual(page.sentForms[0].fields, []);
  });
});
