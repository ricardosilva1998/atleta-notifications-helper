# Voice-to-Chat for iRacing Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable voice-activated chat messaging (private, all, team) inside iRacing via the Atleta Bridge Electron app.

**Architecture:** Web Speech API runs in a Voice Chat overlay renderer process. A main-process module (`voiceInput.js`) coordinates global hotkeys (via `uiohook-napi`) and keyboard simulation (via koffi + Windows `SendInput`). The overlay connects to the existing WebSocket to get driver names for fuzzy matching.

**Tech Stack:** Electron 28, Web Speech API, uiohook-napi (global input hooks), koffi (Windows FFI for SendInput), ws (existing WebSocket)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `bridge/keyboardSim.js` | Create | Windows keyboard simulation via koffi/SendInput — types chat commands into iRacing |
| `bridge/voiceInput.js` | Create | Global hotkey registration via uiohook-napi, IPC coordination between overlay and keyboardSim |
| `bridge/overlays/voicechat.html` | Create | Voice Chat overlay — Web Speech API, voice parsing, driver matching, message log, confirmation UI |
| `bridge/main.js` | Modify | Add voicechat to OVERLAYS array, add voice-related IPC handlers |
| `bridge/control-panel.html` | Modify | Add voicechat to overlay list, add voice settings in customize panel |
| `bridge/package.json` | Modify | Add uiohook-napi dependency |

---

### Task 1: Install uiohook-napi and add to package.json

**Files:**
- Modify: `bridge/package.json`

- [ ] **Step 1: Add uiohook-napi dependency**

In `bridge/package.json`, add `uiohook-napi` to `dependencies`:

```json
{
  "dependencies": {
    "ws": "^8.16.0",
    "@emiliosp/node-iracing-sdk": "^1.0.10",
    "electron-updater": "^6.1.0",
    "uiohook-napi": "^1.5.5"
  }
}
```

- [ ] **Step 2: Install the dependency**

Run:
```bash
cd bridge && npm install
```

Expected: `uiohook-napi` installed with prebuilt binaries (no compilation).

- [ ] **Step 3: Verify it loads in Node**

Run:
```bash
cd bridge && node -e "const { uIOhook, UiohookKey } = require('uiohook-napi'); console.log('OK, keys:', Object.keys(UiohookKey).length);"
```

Expected: `OK, keys: ~90` (no errors).

- [ ] **Step 4: Commit**

```bash
git add bridge/package.json bridge/package-lock.json
git commit -m "feat(bridge): add uiohook-napi for global hotkey support"
```

---

### Task 2: Keyboard Simulator (`bridge/keyboardSim.js`)

**Files:**
- Create: `bridge/keyboardSim.js`

- [ ] **Step 1: Create keyboardSim.js**

```javascript
'use strict';

/**
 * Keyboard simulator for typing into iRacing chat.
 * Uses koffi to call Windows SendInput API.
 * No-ops gracefully on non-Windows platforms.
 */

const isWindows = process.platform === 'win32';

let sendInput = null;
let INPUT_size = 0;

// Windows constants
const INPUT_KEYBOARD = 1;
const KEYEVENTF_UNICODE = 0x0004;
const KEYEVENTF_KEYUP = 0x0002;
const VK_RETURN = 0x0D;
const VK_T = 0x54;

if (isWindows) {
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');

    // Define INPUT structure for keyboard
    const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
      wVk: 'uint16',
      wScan: 'uint16',
      dwFlags: 'uint32',
      time: 'uint32',
      dwExtraInfo: 'uintptr',
    });

    const INPUT = koffi.struct('INPUT', {
      type: 'uint32',
      ki: KEYBDINPUT,
    });

    INPUT_size = koffi.sizeof(INPUT);

    sendInput = user32.func('SendInput', 'uint32', ['uint32', koffi.pointer(INPUT), 'int32']);

    // Helper to wrap the call
    const _sendInput = sendInput;
    sendInput = function(input) {
      return _sendInput(1, input, INPUT_size);
    };

    console.log('[KeyboardSim] Loaded Windows SendInput');
  } catch (e) {
    console.log('[KeyboardSim] Failed to load koffi/user32:', e.message);
    sendInput = null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send a virtual key press (down + up).
 */
async function pressKey(vk) {
  if (!sendInput) return;
  const koffi = require('koffi');
  const KEYBDINPUT = koffi.resolve('KEYBDINPUT');
  const INPUT = koffi.resolve('INPUT');

  const down = { type: INPUT_KEYBOARD, ki: { wVk: vk, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 } };
  const up = { type: INPUT_KEYBOARD, ki: { wVk: vk, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } };
  sendInput(down);
  await sleep(15);
  sendInput(up);
  await sleep(15);
}

/**
 * Type a string using Unicode characters (layout-independent).
 */
async function typeString(str) {
  if (!sendInput) return;
  const koffi = require('koffi');

  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    const down = { type: INPUT_KEYBOARD, ki: { wVk: 0, wScan: charCode, dwFlags: KEYEVENTF_UNICODE, time: 0, dwExtraInfo: 0 } };
    const up = { type: INPUT_KEYBOARD, ki: { wVk: 0, wScan: charCode, dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } };
    sendInput(down);
    await sleep(10);
    sendInput(up);
    await sleep(10);
  }
}

/**
 * Send a chat command to iRacing.
 * Opens chat with T, types the command, presses Enter.
 * @param {string} command - The full chat command (e.g., "/p Max Verstappen good race")
 */
async function sendChatCommand(command) {
  if (!isWindows || !sendInput) {
    console.log('[KeyboardSim] Skipping (not Windows or SendInput unavailable)');
    return false;
  }

  try {
    // Press T to open iRacing chat
    await pressKey(VK_T);
    // Wait for chat box to open
    await sleep(150);
    // Type the command using Unicode input
    await typeString(command);
    await sleep(50);
    // Press Enter to send
    await pressKey(VK_RETURN);
    console.log('[KeyboardSim] Sent: ' + command);
    return true;
  } catch (e) {
    console.log('[KeyboardSim] Error: ' + e.message);
    return false;
  }
}

module.exports = { sendChatCommand };
```

- [ ] **Step 2: Verify module loads without error on macOS (no-op)**

Run:
```bash
cd bridge && node -e "const ks = require('./keyboardSim'); console.log('loaded, sendChatCommand:', typeof ks.sendChatCommand);"
```

Expected: `loaded, sendChatCommand: function` — no crash on macOS (koffi load fails silently).

- [ ] **Step 3: Commit**

```bash
git add bridge/keyboardSim.js
git commit -m "feat(bridge): keyboard simulator for iRacing chat via Windows SendInput"
```

---

### Task 3: Voice Input Module (`bridge/voiceInput.js`)

**Files:**
- Create: `bridge/voiceInput.js`

This module runs in the Electron main process. It registers global hotkeys via `uiohook-napi` and coordinates IPC between the control panel, voice chat overlay, and keyboard simulator.

- [ ] **Step 1: Create voiceInput.js**

```javascript
'use strict';

const { ipcMain } = require('electron');
const { uIOhook, UiohookKey } = require('uiohook-napi');
const { sendChatCommand } = require('./keyboardSim');

// Build reverse lookup: keycode -> name
const keyCodeToName = {};
Object.entries(UiohookKey).forEach(([name, code]) => { keyCodeToName[code] = name; });
// Add mouse button names
const mouseButtonNames = { 1: 'Mouse1', 2: 'Mouse2', 3: 'Mouse3', 4: 'Mouse4', 5: 'Mouse5' };

let voiceChatWindow = null;
let pushToTalkKeyCode = null; // numeric keycode from uiohook
let pushToTalkIsMouseButton = false;
let pushToTalkMouseButton = null;
let isKeyHeld = false;
let settings = {};
let getIracingStatus = null; // function to check if iRacing is connected

/**
 * Initialize the voice input system.
 * @param {object} opts
 * @param {object} opts.settings - Current settings object (mutated externally)
 * @param {function} opts.getStatus - Returns { iracing: bool }
 */
function startVoiceInput(opts) {
  settings = opts.settings;
  getIracingStatus = opts.getStatus;

  // Restore push-to-talk key from settings
  if (settings.voiceChat && settings.voiceChat.pushToTalkKey) {
    applyPushToTalkKey(settings.voiceChat.pushToTalkKey);
  }

  // Global keyboard hook for push-to-talk
  uIOhook.on('keydown', (e) => {
    if (pushToTalkKeyCode !== null && !pushToTalkIsMouseButton && e.keycode === pushToTalkKeyCode && !isKeyHeld) {
      isKeyHeld = true;
      if (voiceChatWindow && !voiceChatWindow.isDestroyed()) {
        voiceChatWindow.webContents.send('voice-start-listening');
      }
    }
  });

  uIOhook.on('keyup', (e) => {
    if (pushToTalkKeyCode !== null && !pushToTalkIsMouseButton && e.keycode === pushToTalkKeyCode && isKeyHeld) {
      isKeyHeld = false;
      if (voiceChatWindow && !voiceChatWindow.isDestroyed()) {
        voiceChatWindow.webContents.send('voice-stop-listening');
      }
    }
  });

  uIOhook.on('mousedown', (e) => {
    if (pushToTalkIsMouseButton && e.button === pushToTalkMouseButton && !isKeyHeld) {
      isKeyHeld = true;
      if (voiceChatWindow && !voiceChatWindow.isDestroyed()) {
        voiceChatWindow.webContents.send('voice-start-listening');
      }
    }
  });

  uIOhook.on('mouseup', (e) => {
    if (pushToTalkIsMouseButton && e.button === pushToTalkMouseButton && isKeyHeld) {
      isKeyHeld = false;
      if (voiceChatWindow && !voiceChatWindow.isDestroyed()) {
        voiceChatWindow.webContents.send('voice-stop-listening');
      }
    }
  });

  uIOhook.start();
  console.log('[VoiceInput] Global hook started');

  // IPC: Overlay sends confirmed chat command
  ipcMain.on('voice-send-chat', (event, data) => {
    const status = getIracingStatus ? getIracingStatus() : { iracing: false };
    if (!status.iracing) {
      console.log('[VoiceInput] Cannot send — iRacing not connected');
      if (voiceChatWindow && !voiceChatWindow.isDestroyed()) {
        voiceChatWindow.webContents.send('voice-send-result', { success: false, reason: 'iRacing not connected' });
      }
      return;
    }
    sendChatCommand(data.command).then(success => {
      if (voiceChatWindow && !voiceChatWindow.isDestroyed()) {
        voiceChatWindow.webContents.send('voice-send-result', { success });
      }
    });
  });

  // IPC: Control panel requests to set push-to-talk key (enters capture mode)
  ipcMain.on('voice-capture-key', (event) => {
    // Next keydown or mousedown sets the push-to-talk key
    const onKey = (e) => {
      const keyName = keyCodeToName[e.keycode] || ('Key' + e.keycode);
      const keyData = { type: 'keyboard', keycode: e.keycode, name: keyName };
      applyPushToTalkKey(keyData);
      event.reply('voice-key-captured', keyData);
      uIOhook.off('keydown', onKey);
      uIOhook.off('mousedown', onMouse);
    };
    const onMouse = (e) => {
      if (e.button <= 2) return; // Ignore left, right, middle — only side buttons
      const name = mouseButtonNames[e.button] || ('Mouse' + e.button);
      const keyData = { type: 'mouse', button: e.button, name };
      applyPushToTalkKey(keyData);
      event.reply('voice-key-captured', keyData);
      uIOhook.off('keydown', onKey);
      uIOhook.off('mousedown', onMouse);
    };
    uIOhook.on('keydown', onKey);
    uIOhook.on('mousedown', onMouse);
  });

  // IPC: Control panel updates voice settings
  ipcMain.on('voice-settings-update', (event, newSettings) => {
    if (!settings.voiceChat) settings.voiceChat = {};
    Object.assign(settings.voiceChat, newSettings);
    // Forward to overlay
    if (voiceChatWindow && !voiceChatWindow.isDestroyed()) {
      voiceChatWindow.webContents.send('voice-settings-update', settings.voiceChat);
    }
  });
}

function applyPushToTalkKey(keyData) {
  if (!keyData) return;
  if (keyData.type === 'mouse') {
    pushToTalkIsMouseButton = true;
    pushToTalkMouseButton = keyData.button;
    pushToTalkKeyCode = null;
  } else {
    pushToTalkIsMouseButton = false;
    pushToTalkMouseButton = null;
    pushToTalkKeyCode = keyData.keycode;
  }
  if (!settings.voiceChat) settings.voiceChat = {};
  settings.voiceChat.pushToTalkKey = keyData;
}

function setVoiceChatWindow(win) {
  voiceChatWindow = win;
  // Send current settings to the overlay when it's set
  if (win && !win.isDestroyed() && settings.voiceChat) {
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('voice-settings-update', settings.voiceChat);
    });
  }
}

function stopVoiceInput() {
  try { uIOhook.stop(); } catch(e) {}
  console.log('[VoiceInput] Stopped');
}

module.exports = { startVoiceInput, stopVoiceInput, setVoiceChatWindow };
```

- [ ] **Step 2: Verify module loads without error**

Run:
```bash
cd bridge && node -e "try { require('./voiceInput'); } catch(e) { console.log('Expected error (no electron):', e.message.substring(0,50)); }"
```

Expected: Error about `electron` not being available (expected outside Electron context), but no `uiohook-napi` or `keyboardSim` import errors.

- [ ] **Step 3: Commit**

```bash
git add bridge/voiceInput.js
git commit -m "feat(bridge): voice input module with push-to-talk and hotkey capture"
```

---

### Task 4: Integrate voice modules into main.js

**Files:**
- Modify: `bridge/main.js:1-32` (imports and OVERLAYS array)
- Modify: `bridge/main.js:85-98` (after startTelemetry)
- Modify: `bridge/main.js:194-257` (createOverlayWindow — add voicechat hook)
- Modify: `bridge/main.js:324-329` (before-quit — stop voice input)

- [ ] **Step 1: Add voicechat to OVERLAYS array and import voiceInput**

In `bridge/main.js`, add the import at line 5 (after telemetry import):

```javascript
const { startVoiceInput, stopVoiceInput, setVoiceChatWindow } = require('./voiceInput');
```

Add voicechat to the OVERLAYS array (after trackmap, line 32):

```javascript
  { id: 'voicechat', name: 'Voice Chat', width: 340, height: 400 },
```

- [ ] **Step 2: Start voice input after telemetry starts**

In `bridge/main.js`, after `startTelemetry(...)` call (after line 98), add:

```javascript
  // Start voice input system
  const { getStatus } = require('./telemetry');
  startVoiceInput({ settings, getStatus });
```

- [ ] **Step 3: Hook voicechat overlay window to voiceInput**

In `bridge/main.js`, inside `createOverlayWindow()`, after `overlayWindows[overlayId] = win;` (line 255), add:

```javascript
  // Wire up voice chat overlay to voice input module
  if (overlayId === 'voicechat') {
    setVoiceChatWindow(win);
  }
```

- [ ] **Step 4: Stop voice input on quit**

In `bridge/main.js`, inside the `before-quit` handler (after `stopTelemetry()` on line 327), add:

```javascript
  stopVoiceInput();
```

- [ ] **Step 5: Clean up voicechat reference on close**

In `bridge/main.js`, inside the overlay `closed` handler (around line 246), add after `delete overlayWindows[overlayId];`:

```javascript
    if (overlayId === 'voicechat') {
      setVoiceChatWindow(null);
    }
```

- [ ] **Step 6: Commit**

```bash
git add bridge/main.js
git commit -m "feat(bridge): integrate voice input and voicechat overlay into main process"
```

---

### Task 5: Voice Chat Overlay (`bridge/overlays/voicechat.html`)

**Files:**
- Create: `bridge/overlays/voicechat.html`

This is the largest task — the overlay handles speech recognition, voice parsing, driver fuzzy matching, message log, and confirmation UI.

- [ ] **Step 1: Create voicechat.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Voice Chat</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: transparent; overflow: hidden; font-family: 'Segoe UI', -apple-system, sans-serif; color: #e8e6f0; scrollbar-width: none; }
    ::-webkit-scrollbar { display: none; }
    .overlay-panel { background: rgba(12,13,20,0.88); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; backdrop-filter: blur(12px); overflow: hidden; display: flex; flex-direction: column; height: 100vh; }
    .overlay-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.04); border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: rgba(255,255,255,0.5); cursor: move; -webkit-app-region: drag; flex-shrink: 0; }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-right: 4px; }
    .status-dot.idle { background: #5c5b6e; }
    .status-dot.listening { background: #f04438; animation: pulse 0.8s ease-in-out infinite; }
    .status-dot.processing { background: #f79009; }
    .status-dot.confirming { background: #3b82f6; animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

    .message-log { flex: 1; overflow-y: auto; padding: 8px 12px; scrollbar-width: none; }
    .message-log::-webkit-scrollbar { display: none; }
    .msg-entry { padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
    .msg-time { font-size: 9px; color: rgba(255,255,255,0.3); }
    .msg-target { font-size: 10px; font-weight: 600; color: #9146ff; margin-left: 6px; }
    .msg-target.all { color: #3ecf8e; }
    .msg-target.team { color: #f79009; }
    .msg-text { font-size: 12px; color: #e8e6f0; margin-top: 2px; }
    .msg-error { font-size: 11px; color: #f04438; padding: 6px 0; }

    .confirm-bar { flex-shrink: 0; padding: 10px 12px; background: rgba(59,130,246,0.1); border-top: 1px solid rgba(59,130,246,0.3); display: none; }
    .confirm-bar.visible { display: block; }
    .confirm-target { font-size: 11px; color: #3b82f6; font-weight: 600; }
    .confirm-text { font-size: 12px; color: #e8e6f0; margin: 4px 0; word-break: break-word; }
    .confirm-hint { font-size: 9px; color: rgba(255,255,255,0.35); }

    .empty-state { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; color: rgba(255,255,255,0.25); font-size: 11px; padding: 20px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="overlay-panel">
    <div class="overlay-header">
      <span><span class="status-dot idle" id="status-dot"></span> VOICE CHAT</span>
      <span id="status-label" style="font-size:9px; color:rgba(255,255,255,0.35);">Idle</span>
    </div>
    <div class="message-log" id="message-log">
      <div class="empty-state" id="empty-state">
        Press your push-to-talk key or say "message" to start.<br>
        Example: "message Max good race"
      </div>
    </div>
    <div class="confirm-bar" id="confirm-bar">
      <div class="confirm-target" id="confirm-target"></div>
      <div class="confirm-text" id="confirm-text"></div>
      <div class="confirm-hint">Enter to send · Esc to cancel</div>
    </div>
  </div>

  <script>
    const { ipcRenderer } = require('electron');

    // ─── State ──────────────────────────────────────────────
    let state = 'idle'; // idle | listening | processing | confirming
    let drivers = []; // from standings WebSocket
    let pendingCommand = null; // { command, targetLabel, text }
    let voiceSettings = { wakeWordEnabled: false, language: 'en-US', micDeviceId: null };
    let recognition = null;
    let wakeWordRecognition = null;
    let wakeWordBuffer = '';

    // ─── WebSocket for driver list ──────────────────────────
    const BRIDGE_URL = 'ws://localhost:9100';
    let ws = null;

    function connectBridge() {
      try { ws = new WebSocket(BRIDGE_URL); } catch(e) { setTimeout(connectBridge, 3000); return; }
      ws.onopen = () => { ws.send(JSON.stringify({ type: 'subscribe', channels: ['standings'] })); };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'data' && msg.channel === 'standings') {
            drivers = (msg.data || []).filter(d => !d.isPlayer && d.driverName && d.driverName !== 'Pace Car');
          }
        } catch(e) {}
      };
      ws.onclose = () => { setTimeout(connectBridge, 3000); };
      ws.onerror = () => { ws.close(); };
    }
    connectBridge();

    // ─── UI Helpers ─────────────────────────────────────────
    function setState(newState) {
      state = newState;
      const dot = document.getElementById('status-dot');
      const label = document.getElementById('status-label');
      dot.className = 'status-dot ' + newState;
      const labels = { idle: 'Idle', listening: 'Listening...', processing: 'Processing...', confirming: 'Confirm' };
      label.textContent = labels[newState] || newState;
    }

    function addMessage(targetLabel, targetType, text) {
      const log = document.getElementById('message-log');
      const empty = document.getElementById('empty-state');
      if (empty) empty.remove();

      const entry = document.createElement('div');
      entry.className = 'msg-entry';
      const now = new Date();
      const time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
      entry.innerHTML = `
        <span class="msg-time">${time}</span>
        <span class="msg-target ${targetType}">${targetLabel}</span>
        <div class="msg-text">${escapeHtml(text)}</div>
      `;
      log.appendChild(entry);
      log.scrollTop = log.scrollHeight;
    }

    function addError(text) {
      const log = document.getElementById('message-log');
      const empty = document.getElementById('empty-state');
      if (empty) empty.remove();

      const entry = document.createElement('div');
      entry.className = 'msg-error';
      entry.textContent = text;
      log.appendChild(entry);
      log.scrollTop = log.scrollHeight;
    }

    function showConfirm(targetLabel, text) {
      document.getElementById('confirm-target').textContent = targetLabel;
      document.getElementById('confirm-text').textContent = '"' + text + '"';
      document.getElementById('confirm-bar').classList.add('visible');
    }

    function hideConfirm() {
      document.getElementById('confirm-bar').classList.remove('visible');
      pendingCommand = null;
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ─── Fuzzy Matching ─────────────────────────────────────
    function levenshtein(a, b) {
      const m = a.length, n = b.length;
      const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
      for (let i = 0; i <= m; i++) dp[i][0] = i;
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
        }
      }
      return dp[m][n];
    }

    function matchDriver(words) {
      if (drivers.length === 0) return null;

      let bestMatch = null;
      let bestScore = Infinity;
      let bestWordsUsed = 0;

      // Try 1, 2, 3 words as driver name
      for (let len = Math.min(3, words.length); len >= 1; len--) {
        const spoken = words.slice(0, len).join(' ').toLowerCase();

        for (const driver of drivers) {
          const fullName = driver.driverName.toLowerCase();
          const firstName = fullName.split(' ')[0];
          const lastName = fullName.split(' ').slice(-1)[0];

          // Check against full name, first name, last name
          const candidates = [fullName, firstName, lastName];
          for (const candidate of candidates) {
            const dist = levenshtein(spoken, candidate);
            // Normalize by candidate length — shorter distances relative to length are better
            const score = dist / Math.max(spoken.length, candidate.length);
            if (score < bestScore && score < 0.45) { // 45% threshold
              bestScore = score;
              bestMatch = driver;
              bestWordsUsed = len;
            }
          }
        }
      }

      // Prefer longer matches (2 words over 1) if scores are close
      if (bestMatch) {
        return { driver: bestMatch, wordsUsed: bestWordsUsed };
      }
      return null;
    }

    // ─── Voice Parsing ──────────────────────────────────────
    function parseVoiceCommand(rawText) {
      let text = rawText.trim().toLowerCase();

      // Strip wake word "message" from start
      if (text.startsWith('message ')) {
        text = text.substring(8).trim();
      }

      // Check for "all" or "team" targets
      if (text.startsWith('all ')) {
        const msg = rawText.trim().substring(rawText.toLowerCase().indexOf('all ') + 4).trim();
        return { command: '/all ' + msg, targetLabel: 'To: All', targetType: 'all', text: msg };
      }
      if (text.startsWith('team ')) {
        const msg = rawText.trim().substring(rawText.toLowerCase().indexOf('team ') + 5).trim();
        return { command: '/team ' + msg, targetLabel: 'To: Team', targetType: 'team', text: msg };
      }

      // Try to match a driver name
      const words = text.split(/\s+/);
      const match = matchDriver(words);
      if (match) {
        const msgWords = words.slice(match.wordsUsed);
        const msg = msgWords.join(' ');
        if (!msg) return { error: 'No message text after driver name' };
        return {
          command: '/p ' + match.driver.driverName + ' ' + msg,
          targetLabel: 'To: ' + match.driver.driverName + ' (private)',
          targetType: '',
          text: msg,
        };
      }

      return { error: 'No driver found matching "' + words.slice(0, 3).join(' ') + '"' };
    }

    // ─── Speech Recognition ─────────────────────────────────
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    function startRecognition() {
      if (!SpeechRecognition) { addError('Speech recognition not available'); return; }
      if (recognition) { try { recognition.abort(); } catch(e) {} }

      recognition = new SpeechRecognition();
      recognition.lang = voiceSettings.language || 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        console.log('[VoiceChat] Heard:', transcript);
        processTranscript(transcript);
      };

      recognition.onerror = (event) => {
        console.log('[VoiceChat] Recognition error:', event.error);
        if (event.error !== 'aborted') {
          setState('idle');
        }
      };

      recognition.onend = () => {
        if (state === 'listening') {
          // Push-to-talk released before any result
          setState('idle');
        }
      };

      setState('listening');
      recognition.start();
    }

    function stopRecognition() {
      if (recognition) {
        try { recognition.stop(); } catch(e) {}
      }
    }

    function processTranscript(transcript) {
      setState('processing');
      const result = parseVoiceCommand(transcript);

      if (result.error) {
        addError(result.error);
        setState('idle');
        return;
      }

      // Show confirmation
      pendingCommand = result;
      showConfirm(result.targetLabel, result.text);
      setState('confirming');
    }

    // ─── Wake Word (Always Listening) ───────────────────────
    function startWakeWord() {
      if (!SpeechRecognition || !voiceSettings.wakeWordEnabled) return;
      if (wakeWordRecognition) { try { wakeWordRecognition.abort(); } catch(e) {} }

      wakeWordRecognition = new SpeechRecognition();
      wakeWordRecognition.lang = voiceSettings.language || 'en-US';
      wakeWordRecognition.continuous = true;
      wakeWordRecognition.interimResults = true;
      wakeWordRecognition.maxAlternatives = 1;

      wakeWordRecognition.onresult = (event) => {
        // Check all results for wake word
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript.trim().toLowerCase();
          if (event.results[i].isFinal) {
            // Full sentence — check if it starts with "message"
            if (transcript.startsWith('message ') && state === 'idle') {
              // Stop wake word recognition, process the full command
              try { wakeWordRecognition.abort(); } catch(e) {}
              processTranscript(event.results[i][0].transcript.trim());
              // Restart wake word after a delay
              setTimeout(startWakeWord, 1000);
            }
          }
        }
      };

      wakeWordRecognition.onerror = (event) => {
        if (event.error !== 'aborted') {
          console.log('[WakeWord] Error:', event.error);
          setTimeout(startWakeWord, 2000);
        }
      };

      wakeWordRecognition.onend = () => {
        // Auto-restart if still enabled
        if (voiceSettings.wakeWordEnabled && state !== 'listening') {
          setTimeout(startWakeWord, 500);
        }
      };

      wakeWordRecognition.start();
      console.log('[WakeWord] Started');
    }

    function stopWakeWord() {
      if (wakeWordRecognition) {
        try { wakeWordRecognition.abort(); } catch(e) {}
        wakeWordRecognition = null;
      }
    }

    // ─── Keyboard Handlers ──────────────────────────────────
    document.addEventListener('keydown', (e) => {
      if (state === 'confirming') {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (pendingCommand) {
            ipcRenderer.send('voice-send-chat', { command: pendingCommand.command });
            addMessage(pendingCommand.targetLabel, pendingCommand.targetType, pendingCommand.text);
            hideConfirm();
            setState('idle');
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          hideConfirm();
          setState('idle');
        }
      }
    });

    // ─── IPC from main process ──────────────────────────────
    ipcRenderer.on('voice-start-listening', () => {
      if (state === 'confirming') return; // Don't interrupt confirmation
      startRecognition();
    });

    ipcRenderer.on('voice-stop-listening', () => {
      stopRecognition();
    });

    ipcRenderer.on('voice-settings-update', (event, newSettings) => {
      const wasWakeWordEnabled = voiceSettings.wakeWordEnabled;
      voiceSettings = { ...voiceSettings, ...newSettings };

      // Update wake word
      if (voiceSettings.wakeWordEnabled && !wasWakeWordEnabled) {
        startWakeWord();
      } else if (!voiceSettings.wakeWordEnabled && wasWakeWordEnabled) {
        stopWakeWord();
      }

      // Update recognition language if active
      if (recognition) recognition.lang = voiceSettings.language;
    });

    ipcRenderer.on('voice-send-result', (event, result) => {
      if (!result.success) {
        addError('Failed to send: ' + (result.reason || 'unknown error'));
      }
    });

    // ─── Lock state ─────────────────────────────────────────
    ipcRenderer.on('lock-state', (event, locked) => {
      document.body.style.pointerEvents = locked ? 'none' : 'auto';
      document.querySelector('.overlay-header').style.cursor = locked ? 'default' : 'move';
    });

    // ─── Init ───────────────────────────────────────────────
    // Wake word auto-start if enabled
    if (voiceSettings.wakeWordEnabled) startWakeWord();
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add bridge/overlays/voicechat.html
git commit -m "feat(bridge): voice chat overlay with speech recognition, parsing, and confirmation UI"
```

---

### Task 6: Update control panel with voice chat settings

**Files:**
- Modify: `bridge/control-panel.html:107-115` (overlays array)
- Modify: `bridge/control-panel.html:144-174` (CUSTOMIZE_FIELDS)

- [ ] **Step 1: Add voicechat to overlays array**

In `bridge/control-panel.html`, in the `overlays` array (around line 107-115), add after the trackmap entry:

```javascript
      { id: 'voicechat', icon: '🎙️', name: 'Voice Chat' },
```

- [ ] **Step 2: Add voicechat customize fields**

In the `CUSTOMIZE_FIELDS` object (around line 144-174), add after the `trackmap` entry:

```javascript
      voicechat: [
        { key: 'pushToTalk', label: 'Push-to-Talk Key', type: 'hotkey', default: null },
        { key: 'wakeWordEnabled', label: 'Wake word ("message") always listening', type: 'checkbox', default: false },
        { key: 'language', label: 'Speech Language', type: 'select', default: 'en-US', options: [
          { value: 'en-US', label: 'English (US)' },
          { value: 'en-GB', label: 'English (UK)' },
          { value: 'pt-BR', label: 'Portuguese (BR)' },
          { value: 'pt-PT', label: 'Portuguese (PT)' },
          { value: 'es-ES', label: 'Spanish' },
          { value: 'fr-FR', label: 'French' },
          { value: 'de-DE', label: 'German' },
        ]},
        { key: 'autoHide', label: 'Auto-hide when iRacing closes', type: 'checkbox', default: true },
      ],
```

- [ ] **Step 3: Add hotkey and select rendering to openCustomize**

In the `openCustomize` function (around line 176-205), the field rendering currently handles `number` and `checkbox` types. Add support for `hotkey` and `select` types. Replace the `content.innerHTML = fields.map(...)` block with:

```javascript
        content.innerHTML = fields.map(f => {
          const val = saved[f.key] !== undefined ? saved[f.key] : f.default;
          if (f.type === 'number') {
            return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:11px;color:#8b8a9e;">${f.label}</span>
              <input type="number" id="cust-${f.key}" value="${val}" min="${f.min}" max="${f.max}" style="width:60px;padding:4px;background:#0c0d14;border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#e8e6f0;font-size:12px;text-align:center;">
            </div>`;
          } else if (f.type === 'checkbox') {
            return `<label style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:11px;color:#8b8a9e;cursor:pointer;">
              <input type="checkbox" id="cust-${f.key}" ${val ? 'checked' : ''} style="accent-color:#9146ff;">
              ${f.label}
            </label>`;
          } else if (f.type === 'hotkey') {
            const keyName = val && val.name ? val.name : 'Not set';
            return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:11px;color:#8b8a9e;">${f.label}</span>
              <button id="cust-${f.key}" onclick="captureHotkey('${f.key}')" style="padding:4px 10px;background:#0c0d14;border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#e8e6f0;font-size:11px;cursor:pointer;min-width:80px;text-align:center;" data-value='${JSON.stringify(val || null)}'>${keyName}</button>
            </div>`;
          } else if (f.type === 'select') {
            return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:11px;color:#8b8a9e;">${f.label}</span>
              <select id="cust-${f.key}" style="padding:4px;background:#0c0d14;border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#e8e6f0;font-size:11px;">
                ${f.options.map(o => `<option value="${o.value}" ${val === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
              </select>
            </div>`;
          }
          return '';
        }).join('');
```

- [ ] **Step 4: Add captureHotkey function and update saveCustomize**

After the `closeCustomize` function (around line 209), add the hotkey capture function:

```javascript
    function captureHotkey(key) {
      const btn = document.getElementById('cust-' + key);
      btn.textContent = 'Press any key...';
      btn.style.borderColor = '#9146ff';
      ipcRenderer.send('voice-capture-key');
      ipcRenderer.once('voice-key-captured', (event, keyData) => {
        btn.textContent = keyData.name;
        btn.dataset.value = JSON.stringify(keyData);
        btn.style.borderColor = 'rgba(255,255,255,0.1)';
      });
    }
```

Update `saveCustomize` to handle the new field types. Replace the `fields.forEach(...)` block inside `saveCustomize` (around line 216-219):

```javascript
      fields.forEach(f => {
        const el = document.getElementById('cust-' + f.key);
        if (f.type === 'number') settings[f.key] = el.value;
        else if (f.type === 'checkbox') settings[f.key] = el.checked;
        else if (f.type === 'hotkey') {
          try { settings[f.key] = JSON.parse(el.dataset.value); } catch(e) { settings[f.key] = null; }
        }
        else if (f.type === 'select') settings[f.key] = el.value;
      });
```

- [ ] **Step 5: Add voice settings forwarding on save**

In `saveCustomize`, after the existing `ipcRenderer.send('save-overlay-settings', ...)` call, add special handling for voicechat settings that forwards them to the voice input module:

```javascript
      // Forward voice settings to voice input module
      if (currentCustomizeId === 'voicechat') {
        const voiceUpdate = {};
        if (settings.pushToTalk !== undefined) voiceUpdate.pushToTalkKey = settings.pushToTalk;
        if (settings.wakeWordEnabled !== undefined) voiceUpdate.wakeWordEnabled = settings.wakeWordEnabled;
        if (settings.language !== undefined) voiceUpdate.language = settings.language;
        ipcRenderer.send('voice-settings-update', voiceUpdate);
      }
```

- [ ] **Step 6: Commit**

```bash
git add bridge/control-panel.html
git commit -m "feat(bridge): voice chat settings UI with hotkey capture, language, and wake word toggle"
```

---

### Task 7: Manual Testing and Polish

**Files:**
- No new files — testing across all components

- [ ] **Step 1: Build and launch the Bridge app**

Run:
```bash
cd bridge && npm start
```

Expected: App launches with system tray icon, control panel shows Voice Chat in the overlay list with a 🎙️ icon.

- [ ] **Step 2: Enable Voice Chat overlay**

Toggle on "Voice Chat" in the control panel. Expected: A transparent overlay window appears showing "Voice Chat" header with grey "Idle" status and the empty state message.

- [ ] **Step 3: Configure push-to-talk hotkey**

Click the ⚙ settings icon next to Voice Chat. Click "Not set" button next to Push-to-Talk Key. Press a key (e.g., F9). Expected: Button updates to show "F9" (or the key name).

Click Save. Expected: Settings are persisted.

- [ ] **Step 4: Test speech recognition**

Hold the configured push-to-talk key and say "message all hello everyone". Release the key. Expected:
- Status dot turns red (listening) while holding
- After release, turns yellow (processing)
- Confirmation bar appears: "To: All" | "hello everyone" | "Enter to send · Esc to cancel"

Press Escape to cancel. Expected: Confirmation bar disappears, status returns to idle.

- [ ] **Step 5: Test driver matching (requires iRacing session)**

With iRacing running and drivers on track, hold push-to-talk and say "message [driver first name] good race". Expected: Overlay fuzzy-matches the driver name and shows confirmation with full driver name.

- [ ] **Step 6: Test sending (requires iRacing session)**

With iRacing focused, confirm a message by pressing Enter. Expected: Bridge simulates keyboard input — opens iRacing chat, types the `/p DriverName message` command, and presses Enter.

- [ ] **Step 7: Test wake word**

In settings, enable "Wake word" toggle. Save. Say "message team pit next lap". Expected: Overlay detects "message" wake word, captures the rest, shows confirmation.

- [ ] **Step 8: Commit any fixes**

```bash
git add -A
git commit -m "fix(bridge): voice chat testing fixes and polish"
```

---

## Verification Checklist

After all tasks, verify:

**Note:** Mic device selection is omitted — Web Speech API uses the system default microphone and does not support selecting a specific device via `deviceId`. Users should set their preferred mic as the Windows default input device.

- [ ] Voice Chat appears in overlay list with 🎙️ icon and toggle
- [ ] Push-to-talk hotkey can be configured (keyboard keys and mouse side buttons)
- [ ] Push-to-talk: hold → listening, release → process speech
- [ ] Wake word "message" triggers recognition when enabled
- [ ] Voice parsing correctly identifies /all, /team, and /p targets
- [ ] Driver name fuzzy matching works with partial names
- [ ] Confirmation bar shows parsed command and responds to Enter/Esc
- [ ] Enter sends chat command via keyboard simulation into iRacing
- [ ] Message log shows sent messages with timestamps
- [ ] Settings persist across app restarts
- [ ] Overlay is lockable (click-through) and follows auto-hide behavior
- [ ] App doesn't crash on macOS (keyboard sim no-ops gracefully)
