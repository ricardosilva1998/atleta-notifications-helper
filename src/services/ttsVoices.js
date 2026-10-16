'use strict';

// The voices a streamer can pick for reading tips aloud: a short, curated list per language (ElevenLabs voices; the
// model is config.tts.model except where MODEL_BY_LANGUAGE below names another). `preview` is the URL of the voice's
// recorded sample in public/tts/previews/ (the language's default line read with "Atleta", 25 euros and the sample
// message, named by its content hash, so it is cached a year). The first voice of a language is its default. English uses ElevenLabs' own premade voices; the
// other languages use native speakers from ElevenLabs' voice library (rate 1, no live moderation, at least a year's
// notice before their owner can withdraw them). How a voice and its preview are added: docs/features/tip-tts.md.

const TTS_LANGUAGES = Object.freeze(['en', 'pt', 'es', 'fr', 'de', 'zh', 'ja']);

const LIST = {
  en: [
    { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', gender: 'female', preview: '/tts/previews/cgSgspJ2msm6clMCkdW9.en.2ff21927.mp3' },
    { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', gender: 'male', preview: '/tts/previews/TX3LPaxmHKxFdv7VOQHJ.en.0b7acc8c.mp3' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'female', preview: '/tts/previews/EXAVITQu4vr4xnSDxMaL.en.c51a31ff.mp3' },
    { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', gender: 'male', preview: '/tts/previews/nPczCjzI2devNBz1zQrb.en.74474994.mp3' },
    { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', gender: 'female', preview: '/tts/previews/FGY2WhTYpPnrIDTdsKH5.en.010ea080.mp3' },
    { id: 'bIHbv24MWmeRgasZH58o', name: 'Will', gender: 'male', preview: '/tts/previews/bIHbv24MWmeRgasZH58o.en.9ea3566b.mp3' },
  ],
  pt: [
    { id: 'IOntNi3WhlrGbqLWGi61', name: 'Beatriz (Portugal)', gender: 'female', preview: '/tts/previews/IOntNi3WhlrGbqLWGi61.pt.207d99fc.mp3' },
    { id: 'DMcOknq8n1B6XshFIJKJ', name: 'Patrício (Portugal)', gender: 'male', preview: '/tts/previews/DMcOknq8n1B6XshFIJKJ.pt.fa49440a.mp3' },
    { id: '33B4UnXyTNbgLmdEDh5P', name: 'Keren (Brasil)', gender: 'female', preview: '/tts/previews/33B4UnXyTNbgLmdEDh5P.pt.b96949fa.mp3' },
    { id: '36rVQA1AOIPwpA3Hg1tC', name: 'Matheus (Brasil)', gender: 'male', preview: '/tts/previews/36rVQA1AOIPwpA3Hg1tC.pt.7a5f6fc5.mp3' },
    { id: 'RGymW84CSmfVugnA5tvA', name: 'Roberta (Brasil)', gender: 'female', preview: '/tts/previews/RGymW84CSmfVugnA5tvA.pt.76b96301.mp3' },
  ],
  es: [
    { id: '1eHrpOW5l98cxiSRjbzJ', name: 'Raquel (España)', gender: 'female', preview: '/tts/previews/1eHrpOW5l98cxiSRjbzJ.es.dcba6462.mp3' },
    { id: 'Nh2zY9kknu6z4pZy6FhD', name: 'David (España)', gender: 'male', preview: '/tts/previews/Nh2zY9kknu6z4pZy6FhD.es.bd5a419c.mp3' },
    { id: 'CaJslL1xziwefCeTNzHv', name: 'Cristina (Latinoamérica)', gender: 'female', preview: '/tts/previews/CaJslL1xziwefCeTNzHv.es.54c8b545.mp3' },
    { id: 'dlGxemPxFMTY7iXagmOj', name: 'Fernando (Latinoamérica)', gender: 'male', preview: '/tts/previews/dlGxemPxFMTY7iXagmOj.es.8b96600d.mp3' },
    { id: 'm7yTemJqdIqrcNleANfX', name: 'Ana María (México)', gender: 'female', preview: '/tts/previews/m7yTemJqdIqrcNleANfX.es.88e8ce6d.mp3' },
  ],
  fr: [
    { id: 'O31r762Gb3WFygrEOGh0', name: 'Victoria', gender: 'female', preview: '/tts/previews/O31r762Gb3WFygrEOGh0.fr.3965a073.mp3' },
    { id: 'AfbuxQ9DVtS4azaxN1W7', name: 'Léo', gender: 'male', preview: '/tts/previews/AfbuxQ9DVtS4azaxN1W7.fr.c6801fd3.mp3' },
    { id: 'McVZB9hVxVSk3Equu8EH', name: 'Audrey', gender: 'female', preview: '/tts/previews/McVZB9hVxVSk3Equu8EH.fr.20951696.mp3' },
    { id: 'aQROLel5sQbj1vuIVi6B', name: 'Nicolas', gender: 'male', preview: '/tts/previews/aQROLel5sQbj1vuIVi6B.fr.1278cbcb.mp3' },
    { id: 'YxrwjAKoUKULGd0g8K9Y', name: 'Lucie', gender: 'female', preview: '/tts/previews/YxrwjAKoUKULGd0g8K9Y.fr.c5947c4c.mp3' },
  ],
  de: [
    { id: 'v3V1d2rk6528UrLKRuy8', name: 'Susi', gender: 'female', preview: '/tts/previews/v3V1d2rk6528UrLKRuy8.de.559b2132.mp3' },
    { id: 'aTTiK3YzK3dXETpuDE2h', name: 'Ben', gender: 'male', preview: '/tts/previews/aTTiK3YzK3dXETpuDE2h.de.2b05d6d6.mp3' },
    { id: 'AnvlJBAqSLDzEevYr9Ap', name: 'Ava', gender: 'female', preview: '/tts/previews/AnvlJBAqSLDzEevYr9Ap.de.7119b617.mp3' },
    { id: 'fzqS9sNPYJhLlhsfDm0l', name: 'Mark', gender: 'male', preview: '/tts/previews/fzqS9sNPYJhLlhsfDm0l.de.a1d6d8a7.mp3' },
    { id: 'FTNCalFNG5bRnkkaP5Ug', name: 'Otto', gender: 'male', preview: '/tts/previews/FTNCalFNG5bRnkkaP5Ug.de.a5541f9a.mp3' },
  ],
  zh: [
    { id: '9lHjugDhwqoxA5MhX0az', name: 'Anna Su', gender: 'female', preview: '/tts/previews/9lHjugDhwqoxA5MhX0az.zh.9e0fd698.mp3' },
    { id: '4VZIsMPtgggwNg7OXbPY', name: 'James Gao', gender: 'male', preview: '/tts/previews/4VZIsMPtgggwNg7OXbPY.zh.1788fe76.mp3' },
    { id: 'hkfHEbBvdQFNX4uWHqRF', name: 'Stacy', gender: 'female', preview: '/tts/previews/hkfHEbBvdQFNX4uWHqRF.zh.d7b2bff3.mp3' },
    { id: 'MI36FIkp9wRP7cpWKPTl', name: 'Evan Zhao', gender: 'male', preview: '/tts/previews/MI36FIkp9wRP7cpWKPTl.zh.cd9c09ab.mp3' },
    { id: 'tOuLUAIdXShmWH7PEUrU', name: 'Julia', gender: 'female', preview: '/tts/previews/tOuLUAIdXShmWH7PEUrU.zh.ff4822d9.mp3' },
    { id: '5mZxJZhSmJTjL7GoYfYI', name: 'Karo Yang', gender: 'male', preview: '/tts/previews/5mZxJZhSmJTjL7GoYfYI.zh.82c05801.mp3' },
  ],
  ja: [
    { id: 'B8gJV1IhpuegLxdpXFOE', name: 'Kuon', gender: 'female', preview: '/tts/previews/B8gJV1IhpuegLxdpXFOE.ja.c76cdf2e.mp3' },
    { id: 'j210dv0vWm7fCknyQpbA', name: 'Hinata', gender: 'male', preview: '/tts/previews/j210dv0vWm7fCknyQpbA.ja.6a710846.mp3' },
    { id: 'fUjY9K2nAIwlALOwSiwc', name: 'Yui', gender: 'female', preview: '/tts/previews/fUjY9K2nAIwlALOwSiwc.ja.b41686a2.mp3' },
    { id: 'Mv8AjrYZCBkdsmDHNwcB', name: 'Ishibashi', gender: 'male', preview: '/tts/previews/Mv8AjrYZCBkdsmDHNwcB.ja.b0c9a6cc.mp3' },
    { id: 'G3EZ8O36A0x9lmeOtr0f', name: 'Kaori', gender: 'female', preview: '/tts/previews/G3EZ8O36A0x9lmeOtr0f.ja.638a4b02.mp3' },
  ],
};

const VOICES = Object.freeze(Object.fromEntries(TTS_LANGUAGES.map((lang) => [
  lang,
  Object.freeze(LIST[lang].map((voice) => Object.freeze(voice))),
])));

function defaultVoice(lang) {
  return VOICES[lang]?.[0]?.id ?? null;
}

function isVoice(lang, id) {
  return Object.hasOwn(VOICES, lang) && VOICES[lang].some((voice) => voice.id === id);
}

// The model a language is spoken with, where it is not the configured one (config.tts.model). Portuguese uses Turbo
// v2.5: Multilingual v2 pulls every Portuguese voice towards a Brazilian accent, and Turbo keeps the Portugal voices
// Portuguese (the owner compared the five models by ear, 2026-10-16). Its previews are recorded with it too.
const MODEL_BY_LANGUAGE = Object.freeze({ pt: 'eleven_turbo_v2_5' });

function modelFor(lang, fallback) {
  return Object.hasOwn(MODEL_BY_LANGUAGE, lang) ? MODEL_BY_LANGUAGE[lang] : fallback;
}

module.exports = { TTS_LANGUAGES, VOICES, MODEL_BY_LANGUAGE, defaultVoice, isVoice, modelFor };
