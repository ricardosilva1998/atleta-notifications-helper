# Voice Chat

Voice-to-iRacing-chat for the Bridge desktop app. Driver speaks → Whisper transcribes → text gets pasted into iRacing's in-game chat. The Bridge code is documented in `bridge/CLAUDE.md`; this file documents the **server-side proxy** that the Bridge talks to.

## Why a Proxy?

The OpenAI API key cannot ship to clients. The Bridge sends WAV bytes to the server, which forwards a multipart request to OpenAI Whisper and returns just the transcribed text. Users can also bring their own OpenAI key via `settings.voiceChat.openaiKey` to short-circuit the proxy.

## Endpoints

### `POST /api/bridge/whisper`

Accepts raw WAV bytes (≤5MB) in the request body. Forwards to OpenAI Whisper. Returns:

```json
{ "text": "transcribed audio" }
```

**Auth:** session cookie OR `?bridge_id=<uuid>` query param matched against `racing_users.bridge_id`. The OPENAI key never ships to clients.

Added in v3.22.2.

### `GET /api/bridge/config`

Returns:

```json
{ "whisperProxyEnabled": true }
```

**Auth:** none — public health check, no secrets in response. Bridge feature-detects proxy availability via this endpoint.

## Fallback

If the proxy is unreachable, the Bridge falls back to PowerShell SAPI (`bridge/speechWorker.ps1`) on Windows for offline transcription.

## Env Vars

- `OPENAI_API_KEY` — optional but required for the Whisper proxy. Without it, voice chat falls back to SAPI on Windows.

## Voice Parsing (Bridge side, summarized)

After transcription, the Bridge parses recognized intents:
- `all [text]` — broadcast to all
- `number [#] [text]` — to driver number
- `[name] [text]` — fuzzy name match (Levenshtein)
- `team [text]` — to team

Confirmation UI shows the parsed message before send. Sent to iRacing via `keyboardSim.js` clipboard paste into iRacing chat. Configurable chat open key (T/Y/U/Enter).

## Push-to-Talk

Global hotkey via `uiohook-napi` (key-down/key-up detection). Supports keyboard keys, mouse side buttons, and gamepad buttons via Gamepad API. Wake word ("message") triggers always-listening mode.
