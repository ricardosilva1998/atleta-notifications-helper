'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain } = require('electron');
const { uIOhook, UiohookKey } = require('uiohook-napi');
const { sendChatCommand, setChatKey } = require('./keyboardSim');

// Map key names to VK codes + scan codes
const CHAT_KEY_MAP = {
  'T': { vk: 0x54, scan: 0x14 },
  'Y': { vk: 0x59, scan: 0x15 },
  'U': { vk: 0x55, scan: 0x16 },
  'Enter': { vk: 0x0D, scan: 0x1C },
};

const logPath = path.join(os.homedir(), 'atleta-bridge.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(msg);
  try { fs.appendFileSync(logPath, line); } catch(e) {}
}

const keyCodeToName = {};
Object.entries(UiohookKey).forEach(([name, code]) => { keyCodeToName[code] = name; });
const mouseButtonNames = { 1: 'Mouse1', 2: 'Mouse2', 3: 'Mouse3', 4: 'Mouse4', 5: 'Mouse5' };

let voiceChatWindow = null;
let pushToTalkKeyCode = null;
let pushToTalkIsMouseButton = false;
let pushToTalkMouseButton = null;
let autoStopTimer = null;
let settings = {};
let getIracingStatus = null;

// ─── Whisper Worker Thread ──────────────────────────────────
const { Worker } = require('worker_threads');
let whisperWorker = null;
let whisperReady = false;
let transcribeCallbacks = new Map();
let transcribeId = 0;

function startWhisperWorker() {
  // Find whisperWorker.js (same path logic as speechWorker.ps1)
  const candidates = [
    path.join(__dirname, 'whisperWorker.js'),
    path.join(process.resourcesPath || __dirname, 'whisperWorker.js'),
    __dirname.replace('app.asar', 'app.asar.unpacked') + path.sep + 'whisperWorker.js',
  ];
  let workerPath = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) { workerPath = p; break; }
  }
  if (!workerPath) {
    log('[Whisper] Worker script not found');
    return;
  }
  log('[Whisper] Starting worker: ' + workerPath);

  whisperWorker = new Worker(workerPath, {
    resourceLimits: {
      maxOldGenerationSizeMb: 2048, // 2GB heap for Whisper
    },
  });

  whisperWorker.on('message', (msg) => {
    if (msg.type === 'log') {
      log('[Whisper] ' + msg.msg);
    } else if (msg.type === 'ready') {
      whisperReady = true;
      if (voiceChatWindow && !voiceChatWindow.isDestroyed()) {
        voiceChatWindow.webContents.send('voice-whisper-ready');
      }
    } else if (msg.type === 'result') {
      const cb = transcribeCallbacks.get(msg.id);
      if (cb) {
        transcribeCallbacks.delete(msg.id);
        cb(msg.text, msg.error);
      }
    }
  });

  whisperWorker.on('error', (err) => {
    log('[Whisper] Worker error: ' + err.message);
  });

  whisperWorker.on('exit', (code) => {
    log('[Whisper] Worker exited: ' + code);
    whisperWorker = null;
    whisperReady = false;
  });
}

function transcribeWav(wavPath) {
  if (!whisperWorker) {
    startWhisperWorker();
  }
  if (!whisperWorker) {
    log('[Whisper] No worker available');
    if (voiceChatWindow && !voiceChatWindow.isDestroyed()) {
      voiceChatWindow.webContents.send('voice-error', 'Whisper not available');
    }
    return;
  }

  const id = ++transcribeId;
  log('[Whisper] Transcribing: ' + wavPath);

  if (voiceChatWindow && !voiceChatWindow.isDestroyed()) {
    voiceChatWindow.webContents.send('voice-whisper-loading');
  }

  transcribeCallbacks.set(id, (text, error) => {
    if (error) {
      log('[Whisper] Error: ' + error);
      if (voiceChatWindow && !voiceChatWindow.isDestroyed()) {
        voiceChatWindow.webContents.send('voice-error', 'Transcription failed');
      }
    } else {
      if (voiceChatWindow && !voiceChatWindow.isDestroyed()) {
        voiceChatWindow.webContents.send('voice-transcript', text);
      }
    }
  });

  whisperWorker.postMessage({ type: 'transcribe', wavPath, id });
}

// ─── Voice Input System ──────────────────────────────────────
function startVoiceInput(opts) {
  settings = opts.settings;
  getIracingStatus = opts.getStatus;

  if (settings.voiceChat && settings.voiceChat.pushToTalkKey) {
    applyPushToTalkKey(settings.voiceChat.pushToTalkKey);
  }

  // Apply saved chat key
  if (settings.voiceChat && settings.voiceChat.chatKey && CHAT_KEY_MAP[settings.voiceChat.chatKey]) {
    const k = CHAT_KEY_MAP[settings.voiceChat.chatKey];
    setChatKey(k.vk, k.scan);
  }

  // Whisper loads lazily on first transcription (pre-loading uses too much memory)

  // Toggle mode: press once to start, press again to stop
  let isRecording = false;
  let lastToggleTime = 0;

  function handlePttToggle() {
    if (!isRecording) {
      isRecording = true;
      log('[VoiceInput] PTT toggle → START');
      if (voiceChatWindow && !voiceChatWindow.isDestroyed()) {
        voiceChatWindow.webContents.send('voice-start-recording');
      }
      if (autoStopTimer) clearTimeout(autoStopTimer);
      autoStopTimer = setTimeout(() => {
        if (isRecording) {
          log('[VoiceInput] Auto-stop after 30s');
          isRecording = false;
          if (voiceChatWindow && !voiceChatWindow.isDestroyed()) {
            voiceChatWindow.webContents.send('voice-stop-recording');
          }
        }
      }, 30000);
    } else {
      isRecording = false;
      if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }
      log('[VoiceInput] PTT toggle → STOP');
      if (voiceChatWindow && !voiceChatWindow.isDestroyed()) {
        voiceChatWindow.webContents.send('voice-stop-recording');
      }
    }
  }

  uIOhook.on('keydown', (e) => {
    if (pushToTalkKeyCode !== null && !pushToTalkIsMouseButton && e.keycode === pushToTalkKeyCode) {
      const now = Date.now();
      if (now - lastToggleTime < 500) return;
      lastToggleTime = now;
      handlePttToggle();
    }
  });

  uIOhook.on('mousedown', (e) => {
    if (pushToTalkIsMouseButton && e.button === pushToTalkMouseButton) {
      const now = Date.now();
      if (now - lastToggleTime < 500) return;
      lastToggleTime = now;
      handlePttToggle();
    }
  });

  uIOhook.start();
  log('[VoiceInput] Global hook started');

  // IPC: Overlay sends recorded WAV file for transcription
  ipcMain.on('voice-wav-ready', (event, wavPath) => {
    transcribeWav(wavPath);
  });

  // IPC: Manual stop from overlay button
  ipcMain.on('voice-manual-stop', () => {
    isRecording = false;
    if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }
    log('[VoiceInput] Manual stop from overlay');
  });

  // IPC: Overlay sends confirmed chat command
  ipcMain.on('voice-send-chat', (event, data) => {
    const status = getIracingStatus ? getIracingStatus() : { iracing: false };
    if (!status.iracing) {
      log('[VoiceInput] Cannot send — iRacing not connected');
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

  // IPC: Control panel requests to set push-to-talk key
  ipcMain.on('voice-capture-key', (event) => {
    const onKey = (e) => {
      const keyName = keyCodeToName[e.keycode] || ('Key' + e.keycode);
      const keyData = { type: 'keyboard', keycode: e.keycode, name: keyName };
      applyPushToTalkKey(keyData);
      event.reply('voice-key-captured', keyData);
      uIOhook.off('keydown', onKey);
      uIOhook.off('mousedown', onMouse);
    };
    const onMouse = (e) => {
      if (e.button <= 2) return;
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
    // Apply chat key setting
    if (newSettings.chatKey && CHAT_KEY_MAP[newSettings.chatKey]) {
      const k = CHAT_KEY_MAP[newSettings.chatKey];
      setChatKey(k.vk, k.scan);
    }
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
  if (win && !win.isDestroyed()) {
    win.webContents.once('did-finish-load', () => {
      if (settings.voiceChat) win.webContents.send('voice-settings-update', settings.voiceChat);
      if (whisperReady) win.webContents.send('voice-whisper-ready');
    });
  }
}

function stopVoiceInput() {
  try { uIOhook.stop(); } catch(e) {}
  log('[VoiceInput] Stopped');
}

module.exports = { startVoiceInput, stopVoiceInput, setVoiceChatWindow };
