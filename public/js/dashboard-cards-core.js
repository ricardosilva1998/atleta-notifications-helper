'use strict';

// The working cards' pure helpers, apart from the page script (public/js/dashboard-cards.js) so node:test loads them
// (tests/dashboardCardsCore.test.js). Dual-exported: window.ATLETA_CARDS for the page, module.exports for Node.
// Served as it is (no build step).
(function () {
  // How many 2 px grid rows a card of this height spans in the packed grid, its 12 px gap below included.
  function rowSpan(height, row = 2, gap = 12) {
    return Math.max(1, Math.ceil((height + gap) / row));
  }

  // A text of the page's table with its {{fields}} filled in, once (as t() does on the server).
  function fill(template, params) {
    return String(template).replace(/\{\{(\w+)\}\}/g, (match, name) => {
      const value = params ? params[name] : undefined;
      return value === undefined || value === null ? '' : String(value);
    });
  }

  // What a fetch() answer means for a card (the page script sends redirect: 'manual', so a redirect is never followed):
  //   { ok: true, status, data }                          the route did it (an answer without `ok` counts);
  //   { ok: false, kind: 'refused', status, code, error, data }   the route said no; `error` is translated;
  //   { ok: false, kind: 'failed', status, … }            the server failed (5xx, or JSON that does not parse), or
  //                                                       answered a page that says nothing about the session (a
  //                                                       rate limit page, a missing page);
  //   { ok: false, kind: 'session', status }              the session ended: the request was redirected (to sign in;
  //                                                       fetch gives an opaque redirect, type 'opaqueredirect' and
  //                                                       status 0, because following it would lead off the site, to
  //                                                       Discord), or a 401 or 403 page came back (the
  //                                                       account-disabled page).
  // A fetch that throws (no network, or no answer in time) is the caller's { ok: false, kind: 'network' }.
  async function readAnswer(response) {
    const type = (response.headers && typeof response.headers.get === 'function' && response.headers.get('content-type')) || '';
    if (!/application\/json/i.test(type)) {
      const ended = response.type === 'opaqueredirect' || response.status === 0 || response.status === 401 || response.status === 403;
      return { ok: false, kind: ended ? 'session' : 'failed', status: response.status };
    }
    let data;
    try {
      data = await response.json();
    } catch (e) {
      return { ok: false, kind: 'failed', status: response.status };
    }
    if (response.ok && !(data && data.ok === false)) return { ok: true, status: response.status, data };
    const refusal = { status: response.status, code: (data && data.code) || null, error: (data && data.error) || null, data };
    return { ok: false, kind: response.status >= 500 ? 'failed' : 'refused', ...refusal };
  }

  // Saves a control's value, newest first: one request at a time; while one is on its way, only the latest change
  // waits (the ones in between are never sent). When nothing is left to send, onDone(lastAnswer, held) runs once,
  // `held` being the last value the server took (the control shows it again when the last answer was a refusal).
  function createLatestQueue(send, { confirmed, onDone }) {
    let busy = false;
    let waiting = false;
    let next;
    let held = confirmed;
    async function run() {
      busy = true;
      let answer;
      while (waiting) {
        const value = next;
        waiting = false;
        try {
          answer = await send(value);
        } catch (e) {
          answer = { ok: false, kind: 'network' };
        }
        if (answer && answer.ok) held = value;
      }
      busy = false;
      onDone(answer, held);
    }
    return {
      push(value) {
        next = value;
        waiting = true;
        if (!busy) run();
      },
      get confirmed() {
        return held;
      },
    };
  }

  // A countdown: m:ss, or h:mm:ss from an hour on; 0:00 once it is over.
  function formatLeft(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const pad = (n) => String(n).padStart(2, '0');
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
  }

  // A time the server stored in UTC: 'YYYY-MM-DD HH:MM:SS' (SQLite) or ISO with its zone. NaN when it is none.
  function parseUtc(value) {
    const text = String(value || '').trim();
    if (!text) return NaN;
    return Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
  }

  const CARDS = { rowSpan, fill, readAnswer, createLatestQueue, formatLeft, parseUtc };
  if (typeof module !== 'undefined' && module.exports) module.exports = CARDS;
  if (typeof window !== 'undefined') window.ATLETA_CARDS = CARDS;
})();
