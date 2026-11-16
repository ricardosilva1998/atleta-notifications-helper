# Security TODO — Remaining Vulnerabilities

Last audited: 2026-04-11. Items marked "fixed" were closed afterwards; `CLAUDE.md` describes the current
security-relevant behaviour (admin, CSRF, secrets at rest, rate limits, uploads).

## High Priority

### 1. OpenAI API Key Exposed via API — CLOSED 2026-11-16
- **Resolution:** code removed 2026-11-16 (the Racing product and its Atleta Racing desktop app were deleted).

### 2. Electron nodeIntegration:true + contextIsolation:false — CLOSED 2026-11-16
- **Resolution:** code removed 2026-11-16 (the Racing product and its Atleta Racing desktop app were deleted).

### 3. Windows Code Signing Disabled — CLOSED 2026-11-16
- **Resolution:** code removed 2026-11-16 (the Racing product and its Atleta Racing desktop app were deleted).

### 4. CSRF Protection Missing on POST Endpoints — fixed (2026-10-14)
- **Fix:** `src/csrf.js`. Every POST, PUT, PATCH and DELETE must come from this site (Origin, or Referer without one) and, from a logged-in visitor, carry the session's token; logout is a POST. The routes programs call skip the Origin part (each with its reason in `CSRF_EXEMPT` there), but still need the token from a logged-in visitor. See "CSRF" in `CLAUDE.md`.

### 5. Pitwall Token in JSON Response — CLOSED 2026-11-16
- **Resolution:** code removed 2026-11-16 (the Racing product and its Atleta Racing desktop app were deleted).

## Medium Priority

### 6. Avatar Upload No Image Format Validation — CLOSED 2026-11-16
- **Resolution:** code removed 2026-11-16 (the Racing product and its Atleta Racing desktop app were deleted).

### 7. Overlay Token Rate Limiting
- **File:** `src/routes/overlay.js`
- **Issue:** No rate limiting on overlay SSE endpoint. Tokens could be enumerated.
- **Fix:** Add `express-rate-limit` middleware: 10 requests/min per IP on `/overlay/events/:token`.
- **Complexity:** Low

### 8. Session Expiry Not Extended on Activity (Racing sessions) — CLOSED 2026-11-16
- **Resolution:** code removed 2026-11-16 (the Racing product and its Atleta Racing desktop app were deleted).

### 9. Timing Oracle on Username Existence — CLOSED 2026-11-16
- **Resolution:** code removed 2026-11-16 (the Racing product and its Atleta Racing desktop app were deleted).

## Low Priority

### 10. Bridge ID in URL Query String — CLOSED 2026-11-16
- **Resolution:** code removed 2026-11-16 (the Racing product and its Atleta Racing desktop app were deleted).

### 11. Socket.io-client CVEs (Transitive) — CLOSED 2026-11-16
- **Package:** `socket.io-client` → `parseuri` (ReDoS)
- **Resolution:** StreamElements was removed entirely, and `socket.io-client` left `package.json` with it.

## Completed (for reference)

- ✅ Team invite codes: 4 bytes → 16 bytes base64url
- ✅ User search: rate limited 10/min, removed iracing_name from results
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
- ✅ OAuth tokens are encrypted at rest (`TOKEN_ENCRYPTION_KEY`); web session ids are stored as hashes
- ✅ Each OAuth connection uses a random state in a short-lived cookie; `/link` URLs are signed and expire after 15 minutes
- ✅ Request bodies are limited (100 kb by default), dashboard uploads count against a per-streamer quota (report screenshots and sounds are also checked by their first bytes), and uploaded files are served with sandbox headers
- ✅ PayPal tips are accepted only for a capture PayPal confirms for the streamer's own account, from a donor record kept on the server
- ✅ Discord servers are claimed only by someone with Manage Server there; every channel a notification goes to is checked against its server
- ✅ Regex banned words are checked before they are saved and are cost-limited per streamer
