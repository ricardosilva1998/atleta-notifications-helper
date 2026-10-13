'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { isAllowedScreenshot, redemptionMediaError, isAllowedSound, soundMimeType } = require('./uploadValidation');

// Synthetic file starts: a real signature followed by filler bytes.
const filler = Buffer.alloc(32, 0x41);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), filler]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), filler]);
const GIF87 = Buffer.concat([Buffer.from('GIF87a', 'latin1'), filler]);
const GIF89 = Buffer.concat([Buffer.from('GIF89a', 'latin1'), filler]);
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBP', 'latin1'), filler]);
const WAVE = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WAVE', 'latin1'), filler]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
const TEXT = Buffer.from('this is plain text and not an image at all');

describe('isAllowedScreenshot', () => {
  test('accepts each allowed image format under its own extension', () => {
    assert.equal(isAllowedScreenshot('png', PNG), true);
    assert.equal(isAllowedScreenshot('jpg', JPEG), true);
    assert.equal(isAllowedScreenshot('jpeg', JPEG), true);
    assert.equal(isAllowedScreenshot('gif', GIF87), true);
    assert.equal(isAllowedScreenshot('gif', GIF89), true);
    assert.equal(isAllowedScreenshot('webp', WEBP), true);
  });

  test('rejects extensions outside the image allowlist, whatever the content', () => {
    for (const ext of ['svg', 'html', 'htm', 'xml', 'js', 'txt', 'bmp', '']) {
      assert.equal(isAllowedScreenshot(ext, PNG), false, `ext "${ext}" must be rejected`);
    }
    assert.equal(isAllowedScreenshot('svg', SVG), false);
  });

  test('rejects an allowed extension when the bytes are not that image', () => {
    assert.equal(isAllowedScreenshot('png', SVG), false);
    assert.equal(isAllowedScreenshot('png', TEXT), false);
    assert.equal(isAllowedScreenshot('png', JPEG), false, 'a JPEG is not a PNG');
    assert.equal(isAllowedScreenshot('jpg', PNG), false, 'a PNG is not a JPEG');
    assert.equal(isAllowedScreenshot('webp', WAVE), false, 'RIFF alone is not WebP');
  });

  test('rejects empty, truncated or missing data', () => {
    assert.equal(isAllowedScreenshot('png', Buffer.alloc(0)), false);
    assert.equal(isAllowedScreenshot('png', PNG.subarray(0, 4)), false);
    assert.equal(isAllowedScreenshot('png', null), false);
    assert.equal(isAllowedScreenshot('png', undefined), false);
  });

  test('does not treat inherited object keys as extensions', () => {
    assert.equal(isAllowedScreenshot('constructor', PNG), false);
    assert.equal(isAllowedScreenshot('toString', PNG), false);
  });
});

describe('redemptionMediaError', () => {
  const TYPE_ERROR = 'media_type must be audio or video';
  const AUDIO_ERROR = 'Audio ext must be mp3, wav, or ogg';
  const VIDEO_ERROR = 'Video ext must be mp4 or webm';

  test('allows the audio and video extensions the upload route accepts', () => {
    for (const ext of ['mp3', 'wav', 'ogg']) assert.equal(redemptionMediaError('audio', ext), null);
    for (const ext of ['mp4', 'webm']) assert.equal(redemptionMediaError('video', ext), null);
  });

  test('rejects any media type other than audio or video', () => {
    for (const type of ['', 'x', 'image', 'html', 'constructor', undefined, null]) {
      assert.equal(redemptionMediaError(type, 'html'), TYPE_ERROR, `type ${type} must be rejected`);
      assert.equal(redemptionMediaError(type, 'mp3'), TYPE_ERROR, `type ${type} must be rejected even with an audio ext`);
    }
  });

  test('rejects extensions outside the allowlist for the media type', () => {
    for (const ext of ['html', 'svg', 'js', 'mp4', '']) assert.equal(redemptionMediaError('audio', ext), AUDIO_ERROR);
    for (const ext of ['html', 'svg', 'js', 'mp3', '']) assert.equal(redemptionMediaError('video', ext), VIDEO_ERROR);
  });
});

describe('isAllowedSound', () => {
  const ID3_MP3 = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([0x04, 0x00, 0x00]), filler]);
  // Frame sync = 0xFF then 0xE?/0xF?: MPEG-1 Layer III (FB, FA), MPEG-2 (F3)
  // and MPEG-2.5 (E3) frame headers.
  const FRAME_MP3 = [0xfb, 0xfa, 0xf3, 0xe3].map((b) => Buffer.concat([Buffer.from([0xff, b, 0x90, 0x00]), filler]));
  const OGG = Buffer.concat([Buffer.from('OggS', 'latin1'), Buffer.from([0x00, 0x02]), filler]);
  const M4A = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x20]), Buffer.from('ftypM4A ', 'latin1'), filler]);
  const HTML = Buffer.from('<!DOCTYPE html><html><body>not a sound</body></html>');

  test('accepts MP3 that starts with an ID3 tag', () => {
    assert.equal(isAllowedSound(ID3_MP3), true);
  });

  test('accepts MP3 that starts with an MPEG frame sync', () => {
    for (const buf of FRAME_MP3) assert.equal(isAllowedSound(buf), true, `0xFF 0x${buf[1].toString(16)}`);
  });

  test('accepts the other formats the uploader sends today: WAV (the trim tool output), OGG and M4A', () => {
    assert.equal(isAllowedSound(WAVE), true);
    assert.equal(isAllowedSound(OGG), true);
    assert.equal(isAllowedSound(M4A), true);
  });

  test('rejects anything else', () => {
    const others = {
      text: TEXT, html: HTML, svg: SVG, png: PNG, jpeg: JPEG, gif: GIF89, webp: WEBP,
      'ff then a non-sync byte': Buffer.concat([Buffer.from([0xff, 0xd0]), filler]),
      'ID3 not at the start': Buffer.concat([Buffer.from(' ID3', 'latin1'), filler]),
    };
    for (const [name, buf] of Object.entries(others)) assert.equal(isAllowedSound(buf), false, `${name} must be rejected`);
  });

  test('rejects empty, truncated or missing data', () => {
    assert.equal(isAllowedSound(Buffer.alloc(0)), false);
    assert.equal(isAllowedSound(ID3_MP3.subarray(0, 4)), false);
    assert.equal(isAllowedSound(null), false);
    assert.equal(isAllowedSound(undefined), false);
    assert.equal(isAllowedSound('ID3 as a string'), false);
  });

  test('soundMimeType names the stored format, or null when it is not a sound', () => {
    assert.equal(soundMimeType(ID3_MP3), 'audio/mpeg');
    assert.equal(soundMimeType(FRAME_MP3[0]), 'audio/mpeg');
    assert.equal(soundMimeType(WAVE), 'audio/wav');
    assert.equal(soundMimeType(OGG), 'audio/ogg');
    assert.equal(soundMimeType(M4A), 'audio/mp4');
    assert.equal(soundMimeType(HTML), null);
    assert.equal(soundMimeType(Buffer.alloc(0)), null);
  });
});
