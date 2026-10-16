'use strict';

// The voices a streamer can pick for reading tips aloud: a short, curated list per language (ElevenLabs voices, one
// model for all seven languages). `preview` is the URL of a recorded sample, or null while there is none. The first
// voice of a language is its default.

const TTS_LANGUAGES = Object.freeze(['en', 'pt', 'es', 'fr', 'de', 'zh', 'ja']);

// ElevenLabs' premade multilingual voices, until the final per-language list is picked.
const PREMADE = Object.freeze([
  Object.freeze({ id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'female', preview: null }),
  Object.freeze({ id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male', preview: null }),
]);

const VOICES = Object.freeze(Object.fromEntries(TTS_LANGUAGES.map((lang) => [lang, PREMADE])));

function defaultVoice(lang) {
  return VOICES[lang]?.[0]?.id ?? null;
}

function isVoice(lang, id) {
  return Object.hasOwn(VOICES, lang) && VOICES[lang].some((voice) => voice.id === id);
}

module.exports = { TTS_LANGUAGES, VOICES, defaultVoice, isVoice };
