const container = document.getElementById('notification-container');
let overlayConfig = {};
const queue = [];
let isPlaying = false;

// Synthesized notification sounds using Web Audio API
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Racing-themed sound synthesis
function createNoise(duration, vol) {
  const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * duration, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  const gain = audioCtx.createGain();
  gain.gain.value = vol;
  source.connect(gain);
  return { source, gain };
}

function engineRev(startFreq, endFreq, duration, vol) {
  const masterVol = (overlayConfig.volume || 0.8) * vol;
  const t = audioCtx.currentTime;

  // Engine oscillator (sawtooth for gritty engine sound)
  const osc1 = audioCtx.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(startFreq, t);
  osc1.frequency.exponentialRampToValueAtTime(endFreq, t + duration * 0.7);
  osc1.frequency.exponentialRampToValueAtTime(endFreq * 0.8, t + duration);

  // Sub-harmonic for rumble
  const osc2 = audioCtx.createOscillator();
  osc2.type = 'sawtooth';
  osc2.frequency.setValueAtTime(startFreq / 2, t);
  osc2.frequency.exponentialRampToValueAtTime(endFreq / 2, t + duration * 0.7);
  osc2.frequency.exponentialRampToValueAtTime(endFreq * 0.4, t + duration);

  // Distortion for engine grit
  const distortion = audioCtx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i * 2) / 256 - 1;
    curve[i] = (Math.PI + 3.4) * x / (Math.PI + 3.4 * Math.abs(x));
  }
  distortion.curve = curve;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(masterVol, t);
  gain.gain.setValueAtTime(masterVol, t + duration * 0.8);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

  osc1.connect(distortion);
  osc2.connect(distortion);
  distortion.connect(gain);
  gain.connect(audioCtx.destination);

  osc1.start(t); osc1.stop(t + duration);
  osc2.start(t); osc2.stop(t + duration);
}

function turboBlowoff(vol) {
  const masterVol = (overlayConfig.volume || 0.8) * vol;
  const t = audioCtx.currentTime;

  // Turbo spool (rising whine)
  const spool = audioCtx.createOscillator();
  spool.type = 'sine';
  spool.frequency.setValueAtTime(2000, t);
  spool.frequency.exponentialRampToValueAtTime(6000, t + 0.3);

  const spoolGain = audioCtx.createGain();
  spoolGain.gain.setValueAtTime(masterVol * 0.3, t);
  spoolGain.gain.setValueAtTime(masterVol * 0.3, t + 0.25);
  spoolGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

  spool.connect(spoolGain);
  spoolGain.connect(audioCtx.destination);
  spool.start(t); spool.stop(t + 0.35);

  // Blow-off valve (filtered noise burst)
  const { source: noise, gain: noiseGain } = createNoise(0.25, masterVol * 0.4);
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(4000, t + 0.3);
  filter.frequency.exponentialRampToValueAtTime(800, t + 0.55);
  filter.Q.value = 2;

  noiseGain.disconnect();
  noise.connect(noiseGain);
  noiseGain.connect(filter);

  const noiseEnv = audioCtx.createGain();
  noiseEnv.gain.setValueAtTime(masterVol * 0.5, t + 0.3);
  noiseEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
  filter.connect(noiseEnv);
  noiseEnv.connect(audioCtx.destination);

  noise.start(t + 0.3); noise.stop(t + 0.55);
}

function tireScreech(vol) {
  const masterVol = (overlayConfig.volume || 0.8) * vol;
  const t = audioCtx.currentTime;
  const { source: noise, gain: noiseGain } = createNoise(0.3, masterVol * 0.3);
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(3000, t);
  filter.frequency.exponentialRampToValueAtTime(6000, t + 0.15);
  filter.frequency.exponentialRampToValueAtTime(2000, t + 0.3);
  filter.Q.value = 8;

  noiseGain.disconnect();
  noise.connect(noiseGain);
  noiseGain.connect(filter);

  const env = audioCtx.createGain();
  env.gain.setValueAtTime(masterVol * 0.35, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  filter.connect(env);
  env.connect(audioCtx.destination);

  noise.start(t); noise.stop(t + 0.3);
}

const soundEffects = {
  // Follow: tire screech + short engine rev
  follow: () => {
    tireScreech(0.3);
    setTimeout(() => engineRev(80, 200, 0.4, 0.2), 200);
  },
  // Subscription: turbo spool + blow-off valve + engine rev
  subscription: () => {
    engineRev(60, 180, 0.6, 0.15);
    turboBlowoff(0.25);
  },
  // Bits: rapid engine revs (nitro boost)
  bits: () => {
    engineRev(100, 400, 0.15, 0.2);
    setTimeout(() => engineRev(200, 600, 0.15, 0.25), 120);
    setTimeout(() => engineRev(300, 800, 0.2, 0.3), 240);
  },
  // Donation: engine start + rev up
  donation: () => {
    engineRev(40, 60, 0.3, 0.15);
    setTimeout(() => engineRev(60, 300, 0.5, 0.25), 250);
  },
  // Raid: multiple engines approaching
  raid: () => {
    engineRev(50, 150, 0.6, 0.12);
    setTimeout(() => engineRev(60, 180, 0.5, 0.15), 100);
    setTimeout(() => engineRev(70, 200, 0.5, 0.18), 200);
    setTimeout(() => tireScreech(0.2), 500);
  },
  // YouTube Super Chat: engine rev + turbo
  yt_superchat: () => {
    engineRev(80, 250, 0.5, 0.2);
    setTimeout(() => turboBlowoff(0.2), 300);
  },
  // YouTube Member: smooth engine purr + rev
  yt_member: () => {
    engineRev(50, 150, 0.6, 0.15);
  },
  // YouTube Gift: double rev burst
  yt_giftmember: () => {
    engineRev(80, 300, 0.3, 0.2);
    setTimeout(() => engineRev(100, 400, 0.3, 0.25), 250);
  },
};

// Connect to SSE
const evtSource = new EventSource(`/overlay/events/${window.OVERLAY_TOKEN}`);

evtSource.onmessage = (e) => {
  const data = JSON.parse(e.data);

  if (data.type === 'config') {
    overlayConfig = data.config;
    return;
  }

  // Check if event type is enabled
  const eventType = data.type;
  const typeConfig = overlayConfig[eventType];
  if (typeConfig && !typeConfig.enabled) return;

  queue.push(data);
  if (!isPlaying) playNext();
};

evtSource.onerror = () => {
  console.log('SSE connection lost, reconnecting...');
};

function playNext() {
  if (queue.length === 0) { isPlaying = false; return; }
  isPlaying = true;
  const event = queue.shift();
  showNotification(event);
}

function showNotification(event) {
  const typeConfig = overlayConfig[event.type] || {};
  const duration = (typeConfig.duration || 5) * 1000;

  // Play notification sound — try custom mp3 first, fall back to synthesized
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const soundUrl = `/overlay/sounds/${event.type}.mp3`;
  const audio = new Audio(soundUrl);
  audio.volume = overlayConfig.volume || 0.8;
  audio.play().then(() => {
    // Custom sound played successfully
  }).catch(() => {
    // No custom sound file, use synthesized
    const playSound = soundEffects[event.type];
    if (playSound) playSound();
  });

  const banner = document.createElement('div');
  banner.className = `banner banner-${event.type} engine-idle`;
  banner.innerHTML = buildBannerContent(event);
  container.appendChild(banner);

  setTimeout(() => {
    banner.classList.add('dismissing');
    banner.addEventListener('animationend', () => {
      banner.remove();
      setTimeout(playNext, 500); // Gap between notifications
    });
  }, duration);
}

function buildBannerContent(event) {
  const checkers = '<div class="checker-top"></div><div class="checker-bottom"></div>';

  switch (event.type) {
    case 'follow':
      return `${checkers}
        <div class="follow-car">🏎️</div>
        <div class="banner-content"><div style="text-align:center">
          <div class="banner-title">New Pit Crew Member!</div>
          <div class="banner-name">${esc(event.data.username)}</div>
          <div class="banner-sub">just joined the race 🏁</div>
        </div></div>`;

    case 'subscription': {
      const d = event.data;
      const detail = d.months && d.months > 1
        ? `Subscribed for <span style="color:#00ff88;font-weight:bold">${d.months} months</span> — Tier ${d.tier || '1'}`
        : d.message ? esc(d.message) : `Tier ${d.tier || '1'} subscriber!`;
      return `${checkers}
        <div class="sub-car-left">🏎️</div>
        <div class="sub-car-right">🏎️</div>
        <div class="banner-content">
          <div class="banner-emoji">🏆</div>
          <div style="text-align:center">
            <div class="banner-title">Podium Finish!</div>
            <div class="banner-name">${esc(d.username)}</div>
            <div class="banner-sub">${detail}</div>
          </div>
          <div class="banner-emoji">🏆</div>
        </div>`;
    }

    case 'bits':
      return `${checkers}
        <div class="burnout-car-right">🏎️</div>
        <div class="fire-single fire-behind-right">🔥</div>
        <div class="burnout-car-left">🏎️</div>
        <div class="fire-single fire-behind-left">🔥</div>
        <div class="tire-smoke ts-1">💨</div><div class="tire-smoke ts-2">💨</div>
        <div class="tire-smoke ts-3">💨</div><div class="tire-smoke ts-4">💨</div>
        <div class="banner-content"><div style="text-align:center">
          <div class="banner-title">Nitro Boost!</div>
          <div class="banner-name">${esc(event.data.username)}</div>
          <div class="banner-sub">fueled up <span style="color:#f7c948;font-weight:bold">${event.data.amount} bits</span> of nitro! 🔥</div>
        </div></div>`;

    case 'donation':
      return `${checkers}
        <div class="sponsor-car">🏎️</div>
        <div class="speed-line sl-1"></div><div class="speed-line sl-2"></div>
        <div class="speed-line sl-3"></div><div class="speed-line sl-4"></div>
        <div class="banner-content">
          <div class="banner-emoji">🛞</div>
          <div style="text-align:center">
            <div class="banner-title">Sponsor Alert!</div>
            <div class="banner-name">${esc(event.data.username)}</div>
            <div class="banner-sub">sponsored the team with <span style="color:#bf00ff;font-weight:bold">$${event.data.amount}</span> 💸</div>
          </div>
          <div class="banner-emoji">🛞</div>
        </div>`;

    case 'raid':
      return `${checkers}
    <div class="raid-car-1">🏎️</div>
    <div class="raid-car-2">🏎️</div>
    <div class="raid-car-3">🏎️</div>
    <div class="banner-content"><div style="text-align:center">
      <div class="banner-title">Incoming Raid!</div>
      <div class="banner-name">${esc(event.data.username)}</div>
      <div class="banner-sub">raiding with <span style="color:#ff4444;font-weight:bold">${event.data.viewers} viewers</span>! 🏁</div>
    </div></div>`;

    case 'yt_superchat':
      return `${checkers}
        <div class="follow-car">🏎️</div>
        <div class="banner-content"><div style="text-align:center">
          <div class="banner-title">Super Chat!</div>
          <div class="banner-name">${esc(event.data.username)}</div>
          <div class="banner-sub">sent <span style="color:#ff4444;font-weight:bold">${esc(event.data.amount)}</span>${event.data.message ? ' — ' + esc(event.data.message) : ''}</div>
        </div></div>`;

    case 'yt_member':
      return `${checkers}
        <div class="sub-car-left">🏎️</div>
        <div class="sub-car-right">🏎️</div>
        <div class="banner-content">
          <div class="banner-emoji">⭐</div>
          <div style="text-align:center">
            <div class="banner-title">New Member!</div>
            <div class="banner-name">${esc(event.data.username)}</div>
            <div class="banner-sub">just became a ${esc(event.data.level || 'member')}!</div>
          </div>
          <div class="banner-emoji">⭐</div>
        </div>`;

    case 'yt_giftmember':
      return `${checkers}
        <div class="burnout-car-right">🏎️</div>
        <div class="fire-single fire-behind-right">🔥</div>
        <div class="burnout-car-left">🏎️</div>
        <div class="fire-single fire-behind-left">🔥</div>
        <div class="banner-content"><div style="text-align:center">
          <div class="banner-title">Gift Alert!</div>
          <div class="banner-name">${esc(event.data.username)}</div>
          <div class="banner-sub">gifted <span style="color:#4285f4;font-weight:bold">${event.data.amount} memberships</span>!</div>
        </div></div>`;

    default: return '';
  }
}

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text || '';
  return d.innerHTML;
}
