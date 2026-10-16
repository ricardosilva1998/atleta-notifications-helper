# The alert looks' recorded sounds

Every alert look (the 26 families of `public/overlay/objects/styles/`, six alerts each) plays a recorded
sound, in two versions the streamer chooses between in the Overlay Builder. Until 16 October 2026 the looks
played sounds synthesized in the browser (oscillators and filtered noise in each family file); those
functions are still registered and now play only when a recording cannot load.

## Where they are

- `public/overlay/objects/sounds/<family>/<key>.<hash>.mp3`: a sound's **default recording**.
- `public/overlay/objects/sounds/<family>/<key>.2.<hash>.mp3`: its **second version**.
- `<key>` is the sound key the family registers (`rcFlyby`, `samuraiBell`, …); `<hash>` is the first ten
  hex digits of the file's SHA-256, so a new recording gets a new name.
- `public/overlay/objects/sounds/manifest.js` lists them (`{ key: [default, second] }`). It is written by
  `node scripts/look-sounds.js` from the files; `--check` fails when it is out of date, and
  `tests/lookSounds.test.js` fails then too.
- 156 sounds × 2 = 312 MP3s, 128 kbps stereo, about 13 MB. Each is mixed to −16 LUFS integrated with its
  sample peaks at −2 dBFS or below, so switching looks does not change the level.

## How they play

- `services/alertStyleBundle.js` serves `manifest.js` joined after the family files
  (`/overlay/objects/styles.js?v=…`; the version covers it), and `services/alertStyles.js` loads it on the
  server, so the overlay, the builder and the save check all know the same keys.
- `kit.registerSoundFiles()` wraps each registered sound: `kit.playSound(key)` fetches and decodes the
  recording once, then plays it through the AudioContext and volume `kit.setAudio()` was given (the
  overlay's `overlayVolume`, 0.8 by default). A sound's second version is the key `<key>.2`.
- The OBS overlay starts loading the six alerts' recordings when the designs arrive (`loadDesignSounds()`
  in `overlay.js`, on `config` and `config-update`), so the first alert's sound is ready.
- A recording that cannot load plays the synthesized sound instead; one that arrives more than 1.5 s after
  its alert is skipped. A sound the streamer uploaded for an alert still plays first, as before.
- The recordings are served with `Cache-Control: public, max-age=31536000, immutable` (their names change
  with their content); everything else under `/overlay/` stays `no-store`.

## Which sound a streamer hears

- The Overlay Builder's Sound tab (in an alert's edit window; `renderSound` in `public/js/builder-cards.js`)
  lists only that alert's sounds: a search box (by name), theme chips, "This look" (the look's own sound,
  its "Version 2", the classic engine sound, "No sound"), then one group per theme with the sounds made for
  this alert's looks, each as a recording and its second version (`soundGroupsFor`, `thisLookRows` in
  `public/js/builder-styles-core.js`). Every row says which alert and look the sound was made for ("🏁 Follow
  · Pill"). A saved sound that belongs to another alert comes first in "This look" as "Current", so a save
  never loses it. ▶ listens without picking; picking a row plays it. A sound the streamer uploaded for the
  alert shows a notice with a link to the overlay settings (OBS plays the upload first). The choice is
  saved in `overlay_designs.style_sound` as `<key>` or `<key>.2`, and as null for the look's own sound; a
  key the release does not know plays the look's own sound, as before.
- A look's own sound is its default recording, **version A** (the owner's decision, 16 October 2026): the
  take that matched its description best, or for the ten sounds redone from the owner's notes their new
  take. Version B, the other take, is version 2 (Samurai's raid keeps the earlier take the owner liked
  there).
- The five Samurai presets (`follow-samurai` … `raid-samurai`) play their Samurai recording
  (`samuraiBlade`, `samuraiTaiko`, `samuraiTally`, `samuraiKoto`, `samuraiTaiko3`) when a streamer picks
  them. An alert with no look stored draws the default look, Glass's (the owner's decision, 16 October
  2026), and plays its recording (`glFollow`, `glSub`, `glBits`, `glDonation`, `glRaid`, `glGiveaway`).
  Today's engine sound stays in every list as "Today's sound".

## Where they came from

- Generated with ElevenLabs Sound Effects (model `eleven_text_to_sound_v2`) on 16 October 2026 under the
  owner's Creator plan, which licenses them for commercial use; ElevenLabs keeps that license for content
  made while subscribed, after a plan ends.
- Each sound is 1–4 parts (a whoosh, an impact, a sting…) placed on the look's timeline where its old
  synthesized sound had its beats, three takes of each part ranked by how well they match their
  description (CLAP), mixed and brought to the same loudness. Version 2 uses the second-best takes.
- The descriptions, takes, mixes and tools live outside the repository, in the gitignored
  `.superpowers/sounds/` (`specs/` holds every part's prompt and timing; `BRIEF.md` the rules they follow).
- Today's synthesized look sounds measured about −36 LUFS at the default volume (−45 to −20), well below
  the default alerts' engine sounds (about −16 to −21); the recordings sit at the level of the engine
  sounds, so a streamer's volume setting still fits.

## Making new recordings

The pipeline that made them is in the gitignored `.superpowers/sounds/`, and its `README.md` says what it
needs (Node, ffmpeg, a Python 3.12 environment from its `requirements.txt`) and how to run it, step by step.
It reads `ELEVENLABS_API_KEY` from the repository's `.env` (development only; the app never reads it), and
ElevenLabs charges 11 credits per second of audio it generates (the first round used 18,330). Its last
step copies the mixes into `public/overlay/objects/sounds/`, as below.

## Replacing or adding a recording

1. Put the new MP3 in the family's folder as `<key>.<hash>.mp3` (or `<key>.2.<hash>.mp3`), the hash being
   `shasum -a 256 file.mp3 | cut -c1-10`, and delete the file it replaces.
2. Run `node scripts/look-sounds.js` to rewrite `manifest.js`.
3. Run the unit suite: `tests/lookSounds.test.js` checks the names, the hashes, that every look's sound
   has both recordings, and that each file is an MP3 of at most 200 kB.
