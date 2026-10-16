'use strict';

// The voices a streamer can pick for reading tips aloud (src/services/ttsVoices.js) and their recorded
// previews in public/tts/previews/ (docs/features/tip-tts.md, "Adding a voice"): every voice of every
// language has its preview, named by its voice, language and content, and no preview is left over.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { TTS_LANGUAGES, VOICES } = require('../src/services/ttsVoices');

const PREVIEWS_DIR = path.join(__dirname, '..', 'public', 'tts', 'previews');
const NAME = /^\/tts\/previews\/([A-Za-z0-9]+)\.([a-z]{2})\.([0-9a-f]{8})\.mp3$/;

test('every language offers 4 to 6 voices, women\'s and men\'s, each once', () => {
  for (const lang of TTS_LANGUAGES) {
    const voices = VOICES[lang];
    assert.ok(voices.length >= 4 && voices.length <= 6, `${lang}: ${voices.length} voices`);
    assert.ok(voices.some((voice) => voice.gender === 'female'), `${lang}: a woman's voice`);
    assert.ok(voices.some((voice) => voice.gender === 'male'), `${lang}: a man's voice`);
    assert.equal(new Set(voices.map((voice) => voice.id)).size, voices.length, `${lang}: no voice twice`);
    for (const voice of voices) assert.ok(voice.name && /^[A-Za-z0-9]{20}$/.test(voice.id), `${lang}: ${voice.id}`);
  }
});

test('every voice has its preview: an MP3 named <voice>.<language>.<first 8 hex of its SHA-256>.mp3', () => {
  for (const lang of TTS_LANGUAGES) {
    for (const voice of VOICES[lang]) {
      const match = NAME.exec(voice.preview || '');
      assert.ok(match, `${lang} ${voice.name}: ${voice.preview}`);
      assert.equal(match[1], voice.id, `${voice.preview} names its voice`);
      assert.equal(match[2], lang, `${voice.preview} names its language`);
      const file = path.join(PREVIEWS_DIR, path.basename(voice.preview));
      assert.ok(fs.existsSync(file), `${voice.preview} exists`);
      const bytes = fs.readFileSync(file);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 8), match[3], `${voice.preview}: its content`);
      const id3 = bytes.subarray(0, 3).toString('latin1') === 'ID3';
      const frame = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
      assert.ok(id3 || frame, `${voice.preview} is an MP3`);
      assert.ok(bytes.length <= 200 * 1024, `${voice.preview}: ${bytes.length} bytes`);
    }
  }
});

test('no file in public/tts/previews/ is a preview no voice uses', () => {
  const used = new Set(TTS_LANGUAGES.flatMap((lang) => VOICES[lang].map((voice) => path.basename(voice.preview || ''))));
  for (const name of fs.readdirSync(PREVIEWS_DIR)) assert.ok(used.has(name), `${name} is a voice's preview`);
});
