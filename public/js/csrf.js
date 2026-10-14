// Sends this page's CSRF token (src/csrf.js) with every request it makes to
// this site that changes something: a hidden _csrf field in each POST form as
// it is sent, and an X-CSRF-Token header on each POST, PUT, PATCH or DELETE
// made with fetch() or XMLHttpRequest (raw uploads included). Requests to
// other sites never get it.
//
// Loaded by src/views/csrf.ejs, which passes the token in data-csrf-token; it
// must run before any script that sends a request. A page shown to a visitor
// who is not logged in gets no token, and the server asks for none.
(function () {
  'use strict';

  // document.currentScript is null when a script loader (Cloudflare's Rocket
  // Loader, for one) runs the file; the tag is then found by its attribute.
  var script = document.currentScript || document.querySelector('script[data-csrf-token]');
  var token = (script && script.getAttribute('data-csrf-token')) || '';
  if (!token) return;
  // Installed once per page, even if the page loads the file twice (header.ejs
  // and a page that includes csrf.ejs itself): wrapping XMLHttpRequest twice
  // would send the header twice.
  if (window.__atletaCsrfInstalled) return;
  window.__atletaCsrfInstalled = true;

  var UNSAFE = /^(post|put|patch|delete)$/i;

  function sameOrigin(url) {
    try {
      return new URL(url, window.location.href).origin === window.location.origin;
    } catch (e) {
      return false;
    }
  }

  // Forms. Read through getAttribute: a field named "method" or "action"
  // hides the form's own properties.
  function addField(form, submitter) {
    var method = (submitter && submitter.getAttribute && submitter.getAttribute('formmethod')) || form.getAttribute('method') || 'get';
    var action = (submitter && submitter.getAttribute && submitter.getAttribute('formaction')) || form.getAttribute('action') || window.location.href;
    if (method.toLowerCase() !== 'post' || !sameOrigin(action)) return;
    var field = form.querySelector('input[name="_csrf"]');
    if (!field) {
      field = document.createElement('input');
      field.type = 'hidden';
      field.name = '_csrf';
      form.appendChild(field);
    }
    field.value = token;
  }

  // A form sent by its button or the Enter key fires "submit"; one sent by a
  // script with form.submit() does not, so that is covered as well.
  document.addEventListener('submit', function (event) {
    if (event.target && event.target.tagName === 'FORM') addField(event.target, event.submitter);
  }, true);
  var nativeSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    addField(this, null);
    return nativeSubmit.apply(this, arguments);
  };

  if (typeof window.fetch === 'function') {
    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        var request = typeof Request === 'function' && input instanceof Request ? input : null;
        var method = (init && init.method) || (request ? request.method : 'GET');
        var url = request ? request.url : String(input);
        if (UNSAFE.test(method) && sameOrigin(url)) {
          var headers = new Headers((init && init.headers) || (request ? request.headers : undefined));
          if (!headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', token);
          init = Object.assign({}, init, { headers: headers });
        }
      } catch (e) {
        // Send the request as it was.
      }
      return nativeFetch.call(window, input, init);
    };
  }

  if (typeof XMLHttpRequest === 'function') {
    var nativeOpen = XMLHttpRequest.prototype.open;
    var nativeSend = XMLHttpRequest.prototype.send;
    var nativeSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function (method, url) {
      this._csrfNeeded = UNSAFE.test(String(method)) && sameOrigin(String(url));
      this._csrfHeaderSet = false; // open() clears the headers a page set
      return nativeOpen.apply(this, arguments);
    };
    // A token the page sets itself is kept, as with fetch(): a second value
    // would be joined to it ("a, b") and refused.
    XMLHttpRequest.prototype.setRequestHeader = function (name) {
      if (String(name).toLowerCase() === 'x-csrf-token') this._csrfHeaderSet = true;
      return nativeSetHeader.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      if (this._csrfNeeded && !this._csrfHeaderSet) {
        try { nativeSetHeader.call(this, 'X-CSRF-Token', token); } catch (e) { /* not opened */ }
      }
      return nativeSend.apply(this, arguments);
    };
  }
})();
