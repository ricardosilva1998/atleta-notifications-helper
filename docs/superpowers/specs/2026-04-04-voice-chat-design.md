# Voice-to-Chat for iRacing Bridge — Design Spec

## Goal

Enable drivers to send in-race chat messages (private, all, team) via voice commands in the Atleta Bridge Electron app, using both push-to-talk and wake word activation.

## Architecture

Four new components inside the Bridge app:

1. **Voice Chat Overlay** (`bridge/overlays/voicechat.html`) — Renderer process running Web Speech API, message log, confirmation UI
2. **Voice Input Module** (`bridge/voiceInput.js`) — Main process, global hotkey registration, IPC coordination between overlay and keyboard simulator
3. **Keyboard Simulator** (`bridge/keyboardSim.js`) — Uses koffi to call Windows `SendInput` API, types chat commands into iRacing
4. **Driver Matcher** — In-overlay logic fuzzy-matching spoken names against session driver list from WebSocket

**Data flow:**
```
User speaks → Web Speech API (overlay renderer) → parse command →
show confirmation in overlay → user presses Enter →
IPC to main process → keyboardSim types into iRacing chat
```

## Voice Chat Overlay (`bridge/overlays/voicechat.html`)

Frameless, transparent, always-on-top Electron BrowserWindow (same as all other overlays). Default size: 340x400. Added to the OVERLAYS array in `main.js`.

### Three UI Sections

**Status Indicator (top bar):**
- Idle (grey) — not listening
- Listening (red pulsing dot) — actively capturing speech
- Processing (yellow) — parsing the command
- Confirming (blue) — showing parsed result, waiting for user

**Message Log (scrollable body):**
- Sent messages with timestamp, target (driver name / all / team), and message text
- Most recent at bottom
- Semi-transparent dark background matching other overlays

**Confirmation Bar (bottom):**
- Appears when a message is parsed
- Format: `To: Max Verstappen (private) | "good race mate"`
- `[Enter to send]` `[Esc to cancel]`
- Enter triggers IPC to main process → keyboard simulation
- Esc dismisses and returns to idle

### WebSocket Connection

Connects to `ws://localhost:9100`, subscribes to `standings` channel to maintain a live driver list for name matching.

## Voice Parsing

**Format:** `"message [target] [text]"`

**Rules (applied in order):**
1. Strip wake word "message" from start of speech text
2. If next word is `"all"` → target: `/all`, rest is message text
3. If next word is `"team"` → target: `/team`, rest is message text
4. Otherwise → fuzzy-match against session driver list to extract driver name, rest is message text

**Driver Name Matching:**
- Get all driver names from standings WebSocket data
- Try progressive matching: check if word 1 matches a driver, then words 1+2, then 1+2+3 (max 3 words). Take the longest match.
- Match against full name (first + last) and first name only
- Use case-insensitive Levenshtein distance for fuzzy matching
- If multiple matches, pick closest match (confirmation UI lets user cancel if wrong)
- If no match: show "No driver found matching [name]" and cancel

**Examples:**
- "message max verstappen good race" → `/p Max Verstappen good race`
- "message all great racing everyone" → `/all great racing everyone`
- "message team pit this lap" → `/team pit this lap`
- "message max good battle" → fuzzy matches "Max Verstappen" → `/p Max Verstappen good battle`

## Keyboard Simulator (`bridge/keyboardSim.js`)

Uses koffi to load Windows `user32.dll` and call `SendInput`.

**Sequence to send a chat message:**
1. Send `T` keypress — opens iRacing chat box
2. Wait ~100ms for chat to open
3. Type the full command string character by character using `KEYEVENTF_UNICODE` flag (handles any keyboard layout, special characters, slashes, spaces)
4. Send `Enter` keypress — sends the message

**Safety:** Only executes when iRacing is connected (checked via telemetry status).

**Timing:** 10-20ms delay between key events to ensure iRacing registers each input. Full command types in under a second.

**Platform:** Windows-only (where iRacing runs). Graceful no-op on macOS/Linux so Bridge doesn't crash during development.

## Push-to-Talk

- Registered via `uiohook-napi` (low-level input hook) in `bridge/voiceInput.js` — needed because Electron's `globalShortcut` only fires key-down, not key-up, and we need both for hold-to-talk
- `uiohook-napi` is a pure JS library (no native compilation) that hooks into OS-level keyboard events
- No default key assigned — user must configure from control panel
- Key-down → IPC tells overlay to start Web Speech API recognition
- Key-up → IPC tells overlay to stop recognition and process result
- Configuration: "Press any key" capture UI in control panel

## Wake Word (Always Listening)

- When enabled, overlay runs Web Speech API continuously (`continuous: true`, `interimResults: true`)
- Listens for "message" as the first word in any interim result
- Once detected, captures everything after "message" until natural speech pause (`onend` event)
- Auto-restarts recognition after each pause
- Toggle on/off from control panel

**Coexistence:** Both modes work simultaneously. Push-to-talk always available regardless of wake word setting. If push-to-talk activates while wake word captured something, push-to-talk takes priority.

## Control Panel UI

New settings section for Voice Chat overlay (in the customize panel when settings icon is clicked):

- **Push-to-talk hotkey:** `[Click to set]` button → press any key to bind. Shows current key name.
- **Wake word:** On/off toggle
- **Microphone:** Dropdown listing available input devices (via `navigator.mediaDevices.enumerateDevices()`)
- **Language:** Dropdown with common options (English, Portuguese, Spanish, French, German)

## Settings Persistence

All voice chat settings saved via existing `bridge/settings.js`:

```json
{
  "voiceChat": {
    "pushToTalkKey": null,
    "wakeWordEnabled": false,
    "micDeviceId": null,
    "language": "en-US"
  }
}
```

**Defaults:** Push-to-talk unbound, wake word off, system default mic, English. Nothing activates until user configures it.

## Files

| File | Action | Purpose |
|------|--------|---------|
| `bridge/overlays/voicechat.html` | Create | Voice recognition, message log, confirmation UI |
| `bridge/voiceInput.js` | Create | Global hotkey registration, IPC coordination |
| `bridge/keyboardSim.js` | Create | Windows SendInput via koffi |
| `bridge/main.js` | Modify | Add voicechat to OVERLAYS, new IPC channels for voice |
| `bridge/control-panel.html` | Modify | Voice chat settings (hotkey, wake word, mic, language) |

No changes needed to `bridge/settings.js` — existing persistence handles new keys automatically.

## IPC Channels (New)

| Channel | Direction | Payload | Purpose |
|---------|-----------|---------|---------|
| `voice-start-listening` | main→overlay | — | Start speech recognition (push-to-talk pressed) |
| `voice-stop-listening` | main→overlay | — | Stop recognition (push-to-talk released) |
| `voice-send-chat` | overlay→main | `{ command: "/p Name msg" }` | User confirmed, type into iRacing |
| `voice-settings-update` | main→overlay | `{ pushToTalkKey, wakeWordEnabled, micDeviceId, language }` | Settings changed from control panel |
| `voice-status` | overlay→main | `{ state: "idle"|"listening"|"confirming" }` | Status updates for control panel indicator |
