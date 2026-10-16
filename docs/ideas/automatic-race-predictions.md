# Idea (parked): automatic Twitch predictions from iRacing races

Status: parked by the owner on 2026-10-16 — "must be carefully studied"; a plan for the future, not scheduled.

## The idea

While the streamer is live and racing, the bot opens a Twitch prediction when a race starts ("Top 5 finish?"), locks it after a short vote, and settles it from the race result — no manual predictions during a race.

## How it would work (first sketch)

1. Live on Twitch, the Atleta Racing app running, the Racing account linked to the streamer account.
2. A race session starts → open the prediction the streamer chose in advance (top 5, win, top half, gain iRating…), with a short voting window (e.g. 2 minutes).
3. The window closes → Twitch locks voting.
4. The race finishes → read the finish position and resolve the prediction (P4 → "Yes").
5. Disconnect, quit or the app stops reporting → after a timeout, cancel (points refunded).

## What exists today

- The Racing app reports a session (`POST /api/session`, with `session_type`), its laps with position (`POST /api/session/:id/lap`) and the finish (`PATCH /api/session/:id/finish`: `finish_position`, iRating change); sessions are tied to the app's `bridge_id` → Racing user → linked streamer.
- `/api/live-session` is a single global heartbeat every 30 s (not per streamer) — not usable as is.
- Predictions: `services/twitchPolls.js` (start, lock, resolve, cancel with the broadcaster token), `services/livePolls.js`, `pollRules.js` (Twitch's limits); needs Affiliate/Partner and `channel:manage:predictions`.

## To study before planning

- **When** the app sends "session started" (at session creation, at the green flag, or after the first lap?) — the vote must open before the start.
- Per-streamer live state from the app (the heartbeat is global today).
- Race formats: heat races, multi-class (class position vs overall), team races and driver swaps, practice/qualifying to ignore, a session joined mid-race.
- Twitch's prediction limits (window 30 s–30 min; how long a locked prediction may wait to be resolved; one prediction at a time; what if the streamer started one by hand).
- Edge cases: tow/DNF, DQ, disconnect and rejoin, the app closing, two races back to back, resolving after the stream ended.
- What the streamer sets: which questions, window length, minimum race length, on/off; how chat is told (the bot's poll announcements exist).
- Whether results can be trusted (the app reports them; a viewer bet should not hinge on a spoofable request — `bridge_id` ownership, `STRICT_SESSION_OWNERSHIP`).
