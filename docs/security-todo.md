# Security TODO — Remaining Vulnerabilities

Last audited: 2026-04-11. Items marked "fixed" were closed afterwards; `CLAUDE.md` describes the current
security-relevant behaviour (admin, CSRF, secrets at rest, rate limits, uploads).

## High Priority

### 1. OpenAI API Key Exposed via API — fixed
- **Fix:** the Whisper proxy (`POST /api/bridge/whisper`, see `docs/features/voice-chat.md`) calls OpenAI server-side, and `GET /api/bridge/config` returns only `{ whisperProxyEnabled }`. The key is never sent to a client.

### 2. Electron nodeIntegration:true + contextIsolation:false
- **Files:** `bridge/main.js` (lines 139, 397, 463 — all BrowserWindow creations)
- **Issue:** All windows (login, control panel, overlays) have full Node.js access. Combined with any XSS, an attacker gets filesystem + shell access.
- **Fix:** Set `nodeIntegration: false`, `contextIsolation: true`. Create preload scripts that expose only needed APIs via `contextBridge.exposeInMainWorld()`. Refactor all 18 overlay HTML files to use the exposed API instead of `require()`.
- **Complexity:** High — every overlay uses `require('fs')`, `require('path')`, `require('os')`, `require('electron').ipcRenderer`

### 3. Windows Code Signing Disabled
- **File:** `bridge/package.json` (`"signAndEditExecutable": false`)
- **Issue:** Bridge EXE is not code-signed. Users get Windows SmartScreen warnings. A MITM could serve fake updates.
- **Fix:** Purchase a Windows code signing certificate (EV recommended for SmartScreen reputation). Configure in `electron-builder` config and GitHub Actions secrets.
- **Complexity:** Medium — needs certificate purchase + CI config

### 4. CSRF Protection Missing on POST Endpoints — fixed (2026-10-14)
- **Fix:** `src/csrf.js`. Every POST, PUT, PATCH and DELETE must come from this site (Origin, or Referer without one) and, from a logged-in visitor, carry the session's token; logout is a POST. The routes programs call skip the Origin part (each with its reason in `CSRF_EXEMPT` there), but still need the token from a logged-in visitor. See "CSRF" in `CLAUDE.md`.

### 5. Pitwall Token in JSON Response
- **File:** `src/routes/racing-auth.js` (line 143, `/racing/auth/login-api`)
- **Issue:** `pitwallToken` returned in JSON. Could be logged, cached, or intercepted.
- **Fix:** Return token in HTTP-only cookie instead. Update `bridge/login.html` and `bridge/pitwallUplink.js` to read from cookie or use a separate token exchange.
- **Complexity:** Medium

## Medium Priority

### 6. Avatar Upload No Image Format Validation
- **File:** `src/routes/racing.js` (avatar endpoint)
- **Issue:** Only checks `data:image/` prefix and size. No magic byte validation.
- **Fix:** Decode base64, check first bytes for PNG (89 50 4E 47) / JPEG (FF D8 FF) / GIF (47 49 46) / WebP (52 49 46 46) headers.
- **Complexity:** Low

### 7. Overlay Token Rate Limiting
- **File:** `src/routes/overlay.js`
- **Issue:** No rate limiting on overlay SSE endpoint. Tokens could be enumerated.
- **Fix:** Add `express-rate-limit` middleware: 10 requests/min per IP on `/overlay/events/:token`.
- **Complexity:** Low

### 8. Session Expiry Not Extended on Activity
- **Files:** `src/server.js`, `src/routes/racing-auth.js`
- **Issue:** Sessions expire after 7 days regardless of activity.
- **Fix:** On each authenticated request, extend `expires_at` by 7 days if less than 1 day remaining.
- **Complexity:** Low

### 9. Timing Oracle on Username Existence
- **File:** `src/routes/racing-auth.js` (login endpoints)
- **Issue:** User-not-found returns faster than wrong-password (bcrypt compare is slow).
- **Fix:** On user-not-found, do a dummy `bcrypt.compare('x', DUMMY_HASH)` before returning.
- **Complexity:** Low

## Low Priority

### 10. Bridge ID in URL Query String
- **File:** `bridge/overlays/spotify.html`
- **Issue:** Bridge ID sent as `?bridge_id=...` in GET request. Logged in server access logs, referrer headers.
- **Fix:** Use POST with body instead of GET with query params. Add `Referrer-Policy: no-referrer`.
- **Complexity:** Low

### 11. Socket.io-client CVEs (Transitive)
- **Package:** `socket.io-client` → `parseuri` (ReDoS)
- **Issue:** 3 moderate CVEs in transitive dependency. No fix available without major version upgrade.
- **Fix:** Wait for upstream fix or replace StreamElements socket.io with direct API/WebSocket.
- **Complexity:** High (StreamElements integration rewrite)

## Completed (for reference)

- ✅ Team invite codes: 4 bytes → 16 bytes base64url
- ✅ User search: rate limited 10/min, removed iracing_name from results
- ✅ Bridge ID: UUID format validation on Spotify endpoints
- ✅ WebSocket: driver team validation before spectating
- ✅ Tip page: removed query param fallback (XSS)
- ✅ PayPal order ID: format validation
- ✅ Sponsor upload: extension whitelist + 5MB limit
- ✅ Sound upload: 10MB size limit
- ✅ XSS: driver names escaped in standings + relative overlays
- ✅ XSS: track/artist names escaped in Spotify overlay
- ✅ XSS: album art URL validated as HTTPS
- ✅ XSS: team names escaped in control panel
- ✅ XSS: release notes escaped in control panel
- ✅ Electron: permissions restricted to media/microphone/clipboard
- ✅ Dependencies: 5 CVEs fixed via npm audit fix
- ✅ Global `_esc()` HTML escape function in overlay-utils.js
- ✅ Admin access is decided by Discord user id (`ADMIN_DISCORD_IDS`), never by a name
- ✅ OAuth tokens and the StreamElements token are encrypted at rest (`TOKEN_ENCRYPTION_KEY`); web session ids are stored as hashes
- ✅ Each OAuth connection uses a random state in a short-lived cookie; `/link` URLs are signed and expire after 15 minutes
- ✅ Request bodies are limited (100 kb by default), dashboard uploads count against a per-streamer quota (report screenshots and sounds are also checked by their first bytes), and uploaded files are served with sandbox headers
- ✅ PayPal tips are accepted only for a capture PayPal confirms for the streamer's own account, from a donor record kept on the server
- ✅ Discord servers are claimed only by someone with Manage Server there; every channel a notification goes to is checked against its server
- ✅ Regex banned words are checked before they are saved and are cost-limited per streamer
