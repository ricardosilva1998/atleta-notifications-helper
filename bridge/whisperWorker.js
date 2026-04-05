'use strict';

// Whisper transcription worker thread
// Runs in a separate thread with its own memory limit (2GB)
// Communicates via parentPort messages

const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');

let whisperPipeline = null;

function log(msg) {
  parentPort.postMessage({ type: 'log', msg });
}

async function initWhisper() {
  if (whisperPipeline) return true;
  log('Loading model (whisper-tiny.en)...');

  try {
    const { pipeline, env } = await import('@xenova/transformers');
    const cacheDir = path.join(os.homedir(), 'Documents', 'Atleta Bridge', 'whisper-models');
    env.cacheDir = cacheDir;
    env.allowLocalModels = true;

    const startTime = Date.now();
    whisperPipeline = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      quantized: true,
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log('Model loaded in ' + elapsed + 's');
    return true;
  } catch(e) {
    log('Failed to load: ' + e.message);
    return false;
  }
}

function decodeWav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataSize = view.getUint32(40, true);
  const dataOffset = 44;
  const numSamples = dataSize / (bitsPerSample / 8) / numChannels;

  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const offset = dataOffset + i * numChannels * (bitsPerSample / 8);
    if (bitsPerSample === 16) {
      samples[i] = view.getInt16(offset, true) / 32768;
    } else if (bitsPerSample === 32) {
      samples[i] = view.getFloat32(offset, true);
    }
  }

  log('Audio: ' + sampleRate + 'Hz, ' + bitsPerSample + 'bit, ' + (numSamples / sampleRate).toFixed(1) + 's');
  return samples;
}

async function transcribe(wavPath) {
  if (!whisperPipeline) {
    const ok = await initWhisper();
    if (!ok) return '';
  }

  const startTime = Date.now();
  const wavBuffer = fs.readFileSync(wavPath);
  const audioData = decodeWav(wavBuffer);

  const result = await whisperPipeline(audioData, {
    language: 'english',
    task: 'transcribe',
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const text = (result.text || '').trim();
  log('Result (' + elapsed + 's): "' + text + '"');

  // Clean up temp file
  try { fs.unlinkSync(wavPath); } catch(e) {}

  return text;
}

// Handle messages from main thread
parentPort.on('message', async (msg) => {
  if (msg.type === 'transcribe') {
    try {
      const text = await transcribe(msg.wavPath);
      parentPort.postMessage({ type: 'result', text, id: msg.id });
    } catch(e) {
      log('Error: ' + e.message);
      parentPort.postMessage({ type: 'result', text: '', id: msg.id, error: e.message });
    }
  } else if (msg.type === 'preload') {
    await initWhisper();
    parentPort.postMessage({ type: 'ready' });
  }
});

log('Worker started');
