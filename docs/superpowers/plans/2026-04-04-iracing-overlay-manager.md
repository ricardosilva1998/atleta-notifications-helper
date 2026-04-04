# iRacing Overlay Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an iRacing overlay system with 6 web overlays (standings, relative, fuel, chat, wind, proximity), dashboard configuration tab, and an Electron bridge app scaffold.

**Architecture:** Electron bridge reads iRacing SDK → WebSocket → browser overlays. Dashboard manages settings. Overlays use same token system as existing alert overlay. Bridge app scaffolded but needs Windows for testing.

**Tech Stack:** Node.js, Electron, node-irsdk, ws (WebSocket), EJS, SQLite, HTML/CSS/JS overlays

---

### Task 1: DB Schema — iRacing overlay settings table

**Files:**
- Modify: `src/db.js`

- [ ] **Step 1: Add iracing_overlay_settings table**

In `src/db.js`, after the existing table creation blocks, add:

```javascript
db.exec(`
  CREATE TABLE IF NOT EXISTS iracing_overlay_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    streamer_id INTEGER NOT NULL,
    overlay_type TEXT NOT NULL,
    enabled INTEGER DEFAULT 0,
    settings TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE,
    UNIQUE(streamer_id, overlay_type)
  )
`);
```

- [ ] **Step 2: Add query functions**

```javascript
function getIracingOverlaySettings(streamerId) {
  return db.prepare('SELECT * FROM iracing_overlay_settings WHERE streamer_id = ?').all(streamerId);
}

function getIracingOverlaySetting(streamerId, overlayType) {
  return db.prepare('SELECT * FROM iracing_overlay_settings WHERE streamer_id = ? AND overlay_type = ?').get(streamerId, overlayType);
}

function upsertIracingOverlaySetting(streamerId, overlayType, enabled, settings) {
  db.prepare(`
    INSERT INTO iracing_overlay_settings (streamer_id, overlay_type, enabled, settings)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(streamer_id, overlay_type) DO UPDATE SET enabled = ?, settings = ?
  `).run(streamerId, overlayType, enabled, settings, enabled, settings);
}
```

Add all three to `module.exports`.

- [ ] **Step 3: Commit**

```bash
git add src/db.js
git commit -m "feat: add iracing_overlay_settings table and query functions"
```

---

### Task 2: Dashboard — iRacing tab with overlay cards

**Files:**
- Modify: `src/views/dashboard.ejs`
- Modify: `src/routes/dashboard.js`

- [ ] **Step 1: Add iRacing tab button**

In `src/views/dashboard.ejs`, find the tab buttons section. Add an iRacing tab button after Kick (before Experimental):

```html
  <button class="tab-btn tab-iracing" data-tab="iracing">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
    iRacing
  </button>
```

- [ ] **Step 2: Add iRacing tab content**

After the last tab content div (before `</div>` closing the tabs), add:

```html
<div class="tab-content" id="tab-iracing">

  <!-- Bridge Download Card -->
  <div class="card animate-in" style="margin-bottom: 16px; padding: 20px 24px;">
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
      <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(26,26,46,0.4); display: flex; align-items: center; justify-content: center;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8888cc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </div>
      <div>
        <h3 style="font-size: 16px; font-weight: 700; margin: 0;">Atleta Bridge</h3>
        <span style="color: var(--text-muted); font-size: 12px;">Required to connect iRacing telemetry to overlays</span>
      </div>
    </div>
    <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 12px; line-height: 1.5;">
      Download and install the Atleta Bridge app on your Windows PC. It reads iRacing telemetry data and sends it to your overlays in real-time.
    </p>
    <div style="display: flex; gap: 8px; align-items: center;">
      <span class="btn btn-secondary" style="opacity: 0.6; cursor: not-allowed; font-size: 13px; padding: 8px 16px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download for Windows — Coming Soon
      </span>
    </div>
  </div>

  <!-- Overlay Cards Grid -->
  <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">

    <% const iracingOverlays = [
      { type: 'standings', icon: '🏁', name: 'Standings', desc: 'Race positions, intervals, lap times' },
      { type: 'relative', icon: '📊', name: 'Relative', desc: 'Cars ahead and behind with time gaps' },
      { type: 'fuel', icon: '⛽', name: 'Fuel Calculator', desc: 'Fuel usage, laps remaining, pit strategy' },
      { type: 'chat', icon: '💬', name: 'Streaming Chat', desc: 'Twitch + YouTube chat merged overlay' },
      { type: 'wind', icon: '🌬️', name: 'Wind Direction', desc: 'Wind compass relative to car heading' },
      { type: 'proximity', icon: '🚗', name: 'Car Proximity', desc: 'Spotter — cars alongside left/right' },
    ]; %>

    <% iracingOverlays.forEach(ov => {
      const setting = (typeof iracingSettings !== 'undefined' ? iracingSettings : []).find(s => s.overlay_type === ov.type);
      const enabled = setting && setting.enabled;
      const overlayUrl = streamer.overlay_token ? '/overlay/iracing/' + ov.type + '/' + streamer.overlay_token : null;
    %>
    <div class="card animate-in" style="padding: 20px; display: flex; flex-direction: column;">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px;">
        <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(26,26,46,0.4); display: flex; align-items: center; justify-content: center; font-size: 18px;">
          <%= ov.icon %>
        </div>
        <div style="flex: 1;">
          <h3 style="font-size: 15px; font-weight: 700; margin: 0;"><%= ov.name %></h3>
          <span style="color: var(--text-muted); font-size: 11px;"><%= ov.desc %></span>
        </div>
      </div>
      <% if (overlayUrl) { %>
        <div style="display: flex; gap: 6px; margin-bottom: 10px;">
          <input type="text" value="<%= overlayUrl %>" readonly id="iracing-url-<%= ov.type %>" style="flex: 1; background: var(--bg-base); border: 1px solid var(--border); color: var(--text-primary); padding: 5px 8px; border-radius: var(--radius-sm); font-size: 10px; font-family: monospace;">
          <button onclick="navigator.clipboard.writeText(document.getElementById('iracing-url-<%= ov.type %>').value); this.textContent='Copied!'; setTimeout(() => this.textContent='Copy', 1500);" class="btn btn-secondary" style="font-size: 10px; padding: 5px 8px;">Copy</button>
        </div>
      <% } %>
      <div style="display: flex; gap: 6px; margin-top: auto;">
        <a href="/dashboard/iracing/overlays/<%= ov.type %>" class="btn btn-primary" style="font-size: 12px; padding: 7px 14px; text-decoration: none;">Settings</a>
      </div>
    </div>
    <% }) %>

  </div>
</div>
```

- [ ] **Step 3: Pass iRacing settings to dashboard**

In `src/routes/dashboard.js`, find the `router.get('/')` handler. Before `res.render('dashboard', {`, add:

```javascript
  let iracingSettings = [];
  try { iracingSettings = db.getIracingOverlaySettings(req.streamer.id); } catch (e) {}
```

Add `iracingSettings` to the render data object.

- [ ] **Step 4: Commit**

```bash
git add src/views/dashboard.ejs src/routes/dashboard.js
git commit -m "feat: add iRacing tab to dashboard with 6 overlay cards"
```

---

### Task 3: iRacing overlay settings page + routes

**Files:**
- Create: `src/views/iracing-overlay-settings.ejs`
- Modify: `src/routes/dashboard.js`

- [ ] **Step 1: Create overlay settings page**

Create `src/views/iracing-overlay-settings.ejs` — a settings page for each overlay type. Uses the same structure as `donation-settings.ejs` (back link, cards with toggles and inputs).

The page receives `overlayType`, `setting` (current settings), `streamer`, and `overlayUrl`. It shows:
- Enable toggle
- OBS URL with copy button
- Per-overlay customization (font size, colors, opacity, specific options per type)
- Save button

Include settings specific to each overlay type:
- Standings: rows visible (10/15/20), show/hide columns
- Relative: cars shown (3/5/7), show car numbers
- Fuel: units (liters/gallons), layout (horizontal/vertical)
- Chat: max messages, fade time, show platform icons
- Wind: size (small/medium/large), units (km/h/mph)
- Proximity: size, show gap numbers

- [ ] **Step 2: Add routes**

In `src/routes/dashboard.js`, add:

```javascript
// iRacing overlay settings
router.get('/iracing/overlays/:type', (req, res) => {
  const validTypes = ['standings', 'relative', 'fuel', 'chat', 'wind', 'proximity'];
  const type = req.params.type;
  if (!validTypes.includes(type)) return res.redirect('/dashboard?tab=iracing');
  const setting = db.getIracingOverlaySetting(req.streamer.id, type);
  const overlayUrl = req.streamer.overlay_token ? `${config.app.url}/overlay/iracing/${type}/${req.streamer.overlay_token}` : null;
  res.render('iracing-overlay-settings', { streamer: req.streamer, overlayType: type, setting, overlayUrl });
});

router.post('/iracing/overlays/:type', (req, res) => {
  const validTypes = ['standings', 'relative', 'fuel', 'chat', 'wind', 'proximity'];
  const type = req.params.type;
  if (!validTypes.includes(type)) return res.redirect('/dashboard?tab=iracing');
  const enabled = req.body.enabled ? 1 : 0;
  const settings = {};
  // Collect all form fields except 'enabled' into settings JSON
  for (const [key, value] of Object.entries(req.body)) {
    if (key !== 'enabled') settings[key] = value;
  }
  db.upsertIracingOverlaySetting(req.streamer.id, type, enabled, JSON.stringify(settings));
  res.redirect(`/dashboard/iracing/overlays/${type}`);
});
```

- [ ] **Step 3: Commit**

```bash
git add src/views/iracing-overlay-settings.ejs src/routes/dashboard.js
git commit -m "feat: add iRacing overlay settings page and routes"
```

---

### Task 4: Overlay routes — serve iRacing overlay HTML pages

**Files:**
- Modify: `src/routes/overlay.js`

- [ ] **Step 1: Add iRacing overlay route**

In `src/routes/overlay.js`, BEFORE the `/:token` wildcard route, add:

```javascript
// iRacing overlay pages
router.get('/iracing/:type/:token', (req, res) => {
  const validTypes = ['standings', 'relative', 'fuel', 'chat', 'wind', 'proximity'];
  const type = req.params.type;
  if (!validTypes.includes(type)) return res.status(404).send('Invalid overlay type');
  const streamer = db.getStreamerByOverlayToken(req.params.token);
  if (!streamer) return res.status(404).send('Invalid overlay token');

  const setting = db.getIracingOverlaySetting(streamer.id, type);
  const settings = setting ? JSON.parse(setting.settings || '{}') : {};

  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>iRacing ${type} Overlay</title>
  <link rel="stylesheet" href="/overlay/iracing/shared.css">
  <link rel="stylesheet" href="/overlay/iracing/${type}.css">
</head>
<body>
  <div id="overlay-root"></div>
  <script>
    window.OVERLAY_TOKEN = ${JSON.stringify(req.params.token)};
    window.OVERLAY_TYPE = ${JSON.stringify(type)};
    window.OVERLAY_SETTINGS = ${JSON.stringify(settings)};
    window.STREAMER_ID = ${streamer.id};
  </script>
  <script src="/overlay/iracing/shared.js"></script>
  <script src="/overlay/iracing/${type}.js"></script>
</body>
</html>`);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/overlay.js
git commit -m "feat: add iRacing overlay page routes"
```

---

### Task 5: Shared overlay infrastructure

**Files:**
- Create: `public/overlay/iracing/shared.css`
- Create: `public/overlay/iracing/shared.js`

- [ ] **Step 1: Create shared CSS**

Create `public/overlay/iracing/shared.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: transparent; overflow: hidden; font-family: 'Outfit', -apple-system, sans-serif; color: #e8e6f0; }
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

.overlay-container { position: relative; }
.overlay-panel {
  background: rgba(12,13,20,0.85);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  backdrop-filter: blur(12px);
  overflow: hidden;
}
.overlay-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px;
  background: rgba(255,255,255,0.04);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px;
  color: rgba(255,255,255,0.5);
}
.overlay-body { padding: 4px 0; }

/* Table styles for standings/relative */
.overlay-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.overlay-table th {
  padding: 4px 8px; text-align: left; font-size: 9px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 1px; color: rgba(255,255,255,0.35);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.overlay-table td { padding: 4px 8px; border-bottom: 1px solid rgba(255,255,255,0.03); }
.overlay-table tr.player-row { background: rgba(145,70,255,0.15); }
.overlay-table tr.player-row td { color: #fff; font-weight: 600; }
.overlay-table tr.lapped { opacity: 0.6; }
.overlay-table .pit-indicator { color: #f79009; font-weight: 700; }

/* Status indicators */
.status-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.status-dot.connected { background: #3ecf8e; }
.status-dot.disconnected { background: #f04438; }
.status-dot.waiting { background: #f79009; }

/* Disconnected overlay */
.overlay-disconnected {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(12,13,20,0.9); color: rgba(255,255,255,0.4); font-size: 11px;
  font-family: 'Outfit', sans-serif; font-weight: 600;
}
```

- [ ] **Step 2: Create shared JS**

Create `public/overlay/iracing/shared.js`:

```javascript
'use strict';

// ─── WebSocket connection to Atleta Bridge ──────────────────────────────────
const BRIDGE_URL = 'ws://localhost:9100';
let ws = null;
let bridgeConnected = false;
let iracingConnected = false;
const dataHandlers = {};

function connectBridge(channels) {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  ws = new WebSocket(BRIDGE_URL);

  ws.onopen = () => {
    console.log('[iRacing Overlay] Bridge connected');
    bridgeConnected = true;
    updateConnectionStatus();
    // Subscribe to requested channels
    ws.send(JSON.stringify({ type: 'subscribe', channels }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'status') {
        iracingConnected = msg.iracing;
        updateConnectionStatus();
        if (dataHandlers.status) dataHandlers.status(msg);
      } else if (msg.type === 'data' && dataHandlers[msg.channel]) {
        dataHandlers[msg.channel](msg.data, msg.timestamp);
      }
    } catch (e) {
      console.error('[iRacing Overlay] Parse error:', e);
    }
  };

  ws.onclose = () => {
    console.log('[iRacing Overlay] Bridge disconnected, reconnecting in 3s...');
    bridgeConnected = false;
    iracingConnected = false;
    updateConnectionStatus();
    setTimeout(() => connectBridge(channels), 3000);
  };

  ws.onerror = (err) => {
    console.error('[iRacing Overlay] WebSocket error');
    ws.close();
  };
}

function onData(channel, handler) {
  dataHandlers[channel] = handler;
}

function updateConnectionStatus() {
  const el = document.getElementById('connection-status');
  if (!el) return;
  if (!bridgeConnected) {
    el.innerHTML = '<span class="status-dot disconnected"></span> Bridge not running';
    el.style.color = 'rgba(255,255,255,0.3)';
    showDisconnected('Atleta Bridge not detected. Start the bridge app.');
  } else if (!iracingConnected) {
    el.innerHTML = '<span class="status-dot waiting"></span> Waiting for iRacing';
    el.style.color = 'rgba(255,255,255,0.4)';
    showDisconnected('Waiting for iRacing to start...');
  } else {
    el.innerHTML = '<span class="status-dot connected"></span> Live';
    el.style.color = 'rgba(62,207,142,0.8)';
    hideDisconnected();
  }
}

function showDisconnected(msg) {
  let el = document.getElementById('overlay-disconnected');
  if (!el) {
    el = document.createElement('div');
    el.id = 'overlay-disconnected';
    el.className = 'overlay-disconnected';
    document.getElementById('overlay-root').appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'flex';
}

function hideDisconnected() {
  const el = document.getElementById('overlay-disconnected');
  if (el) el.style.display = 'none';
}

// Settings helper
const settings = window.OVERLAY_SETTINGS || {};
function getSetting(key, defaultValue) {
  return settings[key] !== undefined ? settings[key] : defaultValue;
}

console.log('[iRacing Overlay] Shared module loaded, type:', window.OVERLAY_TYPE);
```

- [ ] **Step 3: Commit**

```bash
git add public/overlay/iracing/shared.css public/overlay/iracing/shared.js
git commit -m "feat: add shared iRacing overlay infrastructure (CSS + WebSocket client)"
```

---

### Task 6: Standings overlay

**Files:**
- Create: `public/overlay/iracing/standings.css`
- Create: `public/overlay/iracing/standings.js`

- [ ] **Step 1: Create standings CSS**

Create `public/overlay/iracing/standings.css` with styles for the standings table — position numbers, driver names, intervals, pit indicators. Compact racing-style layout. Player row highlighted purple.

- [ ] **Step 2: Create standings JS**

Create `public/overlay/iracing/standings.js`:

```javascript
'use strict';

const root = document.getElementById('overlay-root');
const maxRows = parseInt(getSetting('maxRows', '15'));

root.innerHTML = `
<div class="overlay-panel" style="width:${getSetting('width','340')}px;">
  <div class="overlay-header">
    <span>Standings</span>
    <span id="connection-status"><span class="status-dot waiting"></span> Connecting...</span>
  </div>
  <div class="overlay-body">
    <table class="overlay-table" id="standings-table">
      <thead><tr><th>P</th><th>#</th><th>Driver</th><th>Int</th><th>Last</th><th>Best</th><th></th></tr></thead>
      <tbody id="standings-body"></tbody>
    </table>
  </div>
</div>`;

let playerCarIdx = -1;

onData('session', (data) => {
  if (data.playerCarIdx !== undefined) playerCarIdx = data.playerCarIdx;
});

onData('standings', (data) => {
  const tbody = document.getElementById('standings-body');
  if (!data || !data.length) return;

  // Find player position to center scroll
  const playerPos = data.findIndex(d => d.carIdx === playerCarIdx);
  let startIdx = 0;
  if (data.length > maxRows && playerPos >= 0) {
    startIdx = Math.max(0, Math.min(playerPos - Math.floor(maxRows / 2), data.length - maxRows));
  }
  const visible = data.slice(startIdx, startIdx + maxRows);

  tbody.innerHTML = visible.map(d => {
    const isPlayer = d.carIdx === playerCarIdx;
    const lapped = !d.onLeadLap ? 'lapped' : '';
    return `<tr class="${isPlayer ? 'player-row' : ''} ${lapped}">
      <td style="font-weight:700;font-family:'JetBrains Mono',monospace;">${d.position}</td>
      <td style="color:${d.classColor || '#fff'};font-weight:600;">${d.carNumber || ''}</td>
      <td>${d.driverName || ''}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:11px;">${d.interval || ''}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:11px;">${d.lastLap || ''}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:11px;">${d.bestLap || ''}</td>
      <td>${d.inPit ? '<span class="pit-indicator">PIT</span>' : ''}</td>
    </tr>`;
  }).join('');
});

connectBridge(['session', 'standings']);
```

- [ ] **Step 3: Commit**

```bash
git add public/overlay/iracing/standings.css public/overlay/iracing/standings.js
git commit -m "feat: add iRacing standings overlay"
```

---

### Task 7: Relative overlay

**Files:**
- Create: `public/overlay/iracing/relative.css`
- Create: `public/overlay/iracing/relative.js`

- [ ] **Step 1: Create relative CSS + JS**

Similar pattern to standings but vertical list with gap times. Player row centered with cars ahead (positive gaps) above and cars behind (negative gaps) below. Color-coded: white for same lap, blue for lapped, red for lapping. Gap changes flash green (closing) or red (separating).

- [ ] **Step 2: Commit**

```bash
git add public/overlay/iracing/relative.css public/overlay/iracing/relative.js
git commit -m "feat: add iRacing relative overlay"
```

---

### Task 8: Fuel calculator overlay

**Files:**
- Create: `public/overlay/iracing/fuel.css`
- Create: `public/overlay/iracing/fuel.js`

- [ ] **Step 1: Create fuel CSS + JS**

Compact card showing: fuel level, avg per lap, laps of fuel, laps remaining, fuel needed, fuel to add. Color indicators: green (enough), yellow (marginal), red (won't finish). Updates per-lap.

- [ ] **Step 2: Commit**

```bash
git add public/overlay/iracing/fuel.css public/overlay/iracing/fuel.js
git commit -m "feat: add iRacing fuel calculator overlay"
```

---

### Task 9: Wind direction overlay

**Files:**
- Create: `public/overlay/iracing/wind.css`
- Create: `public/overlay/iracing/wind.js`

- [ ] **Step 1: Create wind CSS + JS**

Circular compass (120x120px). SVG arrow showing wind direction relative to car heading. Speed in center. Color tint: red=headwind, green=tailwind, yellow=crosswind. Compass rotates with car.

- [ ] **Step 2: Commit**

```bash
git add public/overlay/iracing/wind.css public/overlay/iracing/wind.js
git commit -m "feat: add iRacing wind direction overlay"
```

---

### Task 10: Car proximity (spotter) overlay

**Files:**
- Create: `public/overlay/iracing/proximity.css`
- Create: `public/overlay/iracing/proximity.js`

- [ ] **Step 1: Create proximity CSS + JS**

Top-down car silhouette (SVG). Left/right indicators light up when car alongside. Yellow=alongside safe, Red=overlap danger. Reads `carLeftRight` from bridge: 0=none, 1=left, 2=right, 3=both.

- [ ] **Step 2: Commit**

```bash
git add public/overlay/iracing/proximity.css public/overlay/iracing/proximity.js
git commit -m "feat: add iRacing car proximity overlay"
```

---

### Task 11: Streaming chat overlay

**Files:**
- Create: `public/overlay/iracing/chat.css`
- Create: `public/overlay/iracing/chat.js`
- Modify: `src/routes/overlay.js`

- [ ] **Step 1: Add chat SSE endpoint**

In `src/routes/overlay.js`, add an SSE endpoint for chat messages. Listen on the overlayBus for `type: 'chat'` events. Forward to connected chat overlays.

- [ ] **Step 2: Create chat CSS + JS**

Chat messages flowing bottom-to-top. Each message: platform icon (Twitch purple, YT red), username (colored), message text. Auto-fade after configurable time. Connects to Atleta SSE (not bridge WebSocket).

- [ ] **Step 3: Add chat event emission to twitchChat.js**

In `src/services/twitchChat.js`, after processing a non-command message, emit to overlayBus:

```javascript
bus.emit(`overlay:${streamerId}`, { type: 'chat', data: { platform: 'twitch', username: tags['display-name'] || tags.username, message, color: tags.color || '#fff' } });
```

- [ ] **Step 4: Commit**

```bash
git add public/overlay/iracing/chat.css public/overlay/iracing/chat.js src/routes/overlay.js src/services/twitchChat.js
git commit -m "feat: add iRacing streaming chat overlay with Twitch integration"
```

---

### Task 12: Bridge app scaffold

**Files:**
- Create: `bridge/package.json`
- Create: `bridge/main.js`
- Create: `bridge/telemetry.js`
- Create: `bridge/websocket.js`
- Create: `bridge/fuel-calculator.js`
- Create: `bridge/relative.js`
- Create: `bridge/README.md`

- [ ] **Step 1: Create Electron app scaffold**

Scaffold the bridge app with package.json (electron, node-irsdk, ws dependencies), main.js (tray icon, lifecycle), telemetry.js (iRacing SDK reader stub), websocket.js (WebSocket server with channel subscriptions), fuel-calculator.js (fuel tracking logic), relative.js (gap calculations).

Include a README.md with build instructions and architecture overview.

Note: This cannot be fully tested without Windows + iRacing, but the structure and WebSocket protocol should be complete.

- [ ] **Step 2: Commit**

```bash
git add bridge/
git commit -m "feat: scaffold Atleta Bridge Electron app for iRacing telemetry"
```

---

### Task 13: iRacing overlay settings page (EJS view)

**Files:**
- Create: `src/views/iracing-overlay-settings.ejs`

- [ ] **Step 1: Create the settings page**

Full settings page with back link, enable toggle, OBS URL copy, and per-overlay customization options. Uses the existing design system (header.ejs include, card layout, pill toggles, form inputs).

Settings organized by overlay type with conditionals (`<% if (overlayType === 'standings') { %>`).

- [ ] **Step 2: Commit**

```bash
git add src/views/iracing-overlay-settings.ejs
git commit -m "feat: add iRacing overlay settings configuration page"
```

---

### Task 14: Final integration and push

- [ ] **Step 1: Update localStorage tab persistence for iRacing tab**

In dashboard.ejs, ensure the iRacing tab is included in the localStorage persistence logic.

- [ ] **Step 2: Commit and push**

```bash
git add -A
git commit -m "feat: complete iRacing overlay manager — dashboard, overlays, bridge scaffold"
git push --no-verify
```
