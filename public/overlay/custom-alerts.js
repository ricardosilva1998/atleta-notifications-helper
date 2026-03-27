// Custom alerts overlay — OBS browser source client
let serverVersion = null;
let evtSource = null;
let reconnectTimer = null;

const alertQueue = [];
let isPlaying = false;

function connectSSE() {
  if (evtSource) { evtSource.close(); evtSource = null; }

  evtSource = new EventSource(`/overlay/custom-alerts/events/${window.OVERLAY_TOKEN}`);

  evtSource.onmessage = (e) => {
    const data = JSON.parse(e.data);

    if (data.type === 'config') {
      if (serverVersion && data.serverVersion && data.serverVersion !== serverVersion) {
        location.reload();
        return;
      }
      serverVersion = data.serverVersion;
      return;
    }

    if (data.type === 'custom-alert-trigger') {
      alertQueue.push(data.data);
      if (!isPlaying) playNext();
    }
  };

  evtSource.onerror = () => {
    evtSource.close();
    evtSource = null;
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => { reconnectTimer = null; connectSSE(); }, 5000);
    }
  };
}

connectSSE();

// ─── Queue playback ───────────────────────────────────────────

function playNext() {
  if (alertQueue.length === 0) {
    isPlaying = false;
    return;
  }

  isPlaying = true;
  const config = alertQueue.shift();

  const container = document.getElementById('alert-container');

  // Build full-screen wrapper
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.inset = '0';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '9999';

  // Apply entrance animation
  const animType = capitalize(config.animation || 'fade');
  el.style.animation = `customAlert${animType} 0.5s ease both`;

  // Render template
  if (config.template === 'image-popup') {
    renderImagePopup(el, config);
  } else if (config.template === 'text-popup') {
    renderTextPopup(el, config);
  }

  container.appendChild(el);

  // Play sound if configured
  if (config.sound) {
    playSound(config.sound, config.volume != null ? config.volume : 1.0);
  }

  // Auto-remove after duration
  const duration = (config.duration != null ? config.duration : 5) * 1000;
  setTimeout(() => {
    el.remove();
    playNext();
  }, duration);
}

// ─── Template renderers ───────────────────────────────────────

function renderImagePopup(el, config) {
  const img = document.createElement('img');
  img.src = config.imageUrl;
  img.alt = config.label || 'Alert';
  img.style.maxWidth = '80%';
  img.style.maxHeight = '80%';
  img.style.objectFit = 'contain';
  img.style.display = 'block';
  el.appendChild(img);
}

function renderTextPopup(el, config) {
  const span = document.createElement('span');
  span.textContent = config.text || '';
  span.style.color = config.color || '#ffffff';
  span.style.fontSize = config.size ? config.size + 'px' : '72px';
  span.style.fontWeight = '800';
  span.style.textAlign = 'center';
  span.style.lineHeight = '1.2';
  span.style.textShadow = '0 2px 12px rgba(0,0,0,0.8)';
  span.style.padding = '0 40px';
  span.style.wordBreak = 'break-word';
  if (config.font) {
    span.style.fontFamily = config.font;
  }
  el.appendChild(span);
}

// ─── Sound playback ───────────────────────────────────────────

function playSound(src, volume) {
  try {
    const audio = new Audio(src);
    audio.volume = Math.max(0, Math.min(1, volume != null ? volume : 1.0));
    audio.play().catch(() => {});
  } catch (e) {}
}

// ─── Helpers ──────────────────────────────────────────────────

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
