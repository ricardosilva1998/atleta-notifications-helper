// Info bar overlay — OBS browser source client
// Handles social-bar and ticker overlay types
let serverVersion = null;
let evtSource = null;
let reconnectTimer = null;

// Active bar overlays keyed by overlay ID
const activeBars = {};

// ─── SSE Connection ────────────────────────────────────────────────────────

function connectSSE() {
  if (evtSource) { evtSource.close(); evtSource = null; }

  evtSource = new EventSource(`/overlay/bar/events/${window.OVERLAY_TOKEN}`);

  evtSource.onmessage = (e) => {
    const data = JSON.parse(e.data);

    if (data.type === 'config') {
      if (serverVersion && data.serverVersion && data.serverVersion !== serverVersion) {
        location.reload();
        return;
      }
      serverVersion = data.serverVersion;

      // Render all active/always_on overlays from config
      if (data.overlays) {
        data.overlays.forEach(overlay => {
          if (overlay.enabled && (overlay.always_on || overlay.active)) {
            renderBar(overlay);
          }
        });
      }
      return;
    }

    if (data.type === 'bar-toggle') {
      const { overlayId, visible, overlay } = data;
      if (visible && overlay) {
        renderBar(overlay);
      } else {
        removeBar(overlayId);
      }
      return;
    }

    if (data.type === 'bar-remove') {
      removeBar(data.overlayId);
      return;
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

// ─── SVG Icons ─────────────────────────────────────────────────────────────

const SOCIAL_ICONS = {
  twitter: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.261 5.634 5.903-5.634zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>`,

  instagram: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
  </svg>`,

  youtube: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>`,

  twitch: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
  </svg>`,

  tiktok: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V9.21a8.16 8.16 0 004.77 1.52V7.28a4.85 4.85 0 01-1-.59z"/>
  </svg>`,

  discord: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028 14.09 14.09 0 001.226-1.994.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>`,

  github: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
  </svg>`,

  facebook: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>`,

  link: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>`,
};

// ─── Bar Rendering ─────────────────────────────────────────────────────────

function renderBar(overlay) {
  // Remove any existing instance of this overlay
  removeBar(overlay.id, /* immediate */ true);

  const config = overlay.config || {};
  const position = config.position || 'bottom';

  const el = document.createElement('div');
  el.dataset.overlayId = overlay.id;
  el.style.cssText = [
    'position: fixed',
    position === 'top' ? 'top: 0' : 'bottom: 0',
    'left: 0',
    'right: 0',
    'z-index: 9000',
    'pointer-events: none',
    'animation: fadeIn 0.4s ease-out forwards',
  ].join('; ');

  const overlayType = overlay.type || 'social-bar';

  if (overlayType === 'social-bar') {
    renderSocialBar(el, config);
  } else if (overlayType === 'ticker') {
    renderTicker(el, config);
  }

  const container = document.getElementById('bar-container');
  if (container) {
    container.appendChild(el);
  } else {
    document.body.appendChild(el);
  }

  activeBars[overlay.id] = el;
}

function renderSocialBar(el, config) {
  const bgColor = config.background_color || 'rgba(0, 0, 0, 0.75)';
  const textColor = config.text_color || '#ffffff';
  const accentColor = config.accent_color || '#9146ff';
  const fontSize = config.font_size || 14;
  const scrolling = config.scrolling || false;
  const platforms = config.platforms || [];

  el.style.cssText += '; overflow: hidden';

  const bar = document.createElement('div');
  bar.style.cssText = [
    `background: ${bgColor}`,
    `color: ${textColor}`,
    `font-size: ${fontSize}px`,
    'display: flex',
    'align-items: center',
    'padding: 8px 16px',
    'gap: 20px',
    'white-space: nowrap',
    'backdrop-filter: blur(4px)',
    '-webkit-backdrop-filter: blur(4px)',
  ].join('; ');

  if (config.label) {
    const label = document.createElement('span');
    label.textContent = config.label;
    label.style.cssText = [
      `color: ${accentColor}`,
      'font-weight: 700',
      'font-size: 11px',
      'text-transform: uppercase',
      'letter-spacing: 2px',
      'flex-shrink: 0',
    ].join('; ');
    bar.appendChild(label);

    const sep = document.createElement('span');
    sep.style.cssText = `width: 1px; align-self: stretch; background: ${accentColor}; opacity: 0.4; flex-shrink: 0;`;
    bar.appendChild(sep);
  }

  const iconsWrap = document.createElement('div');
  iconsWrap.style.cssText = 'display: flex; align-items: center; gap: 16px; flex: 1; overflow: hidden;';

  const iconsInner = document.createElement('div');

  if (scrolling) {
    // Duplicate content for seamless loop
    iconsInner.style.cssText = 'display: flex; align-items: center; gap: 16px; animation: scrollLeft 25s linear infinite;';
    const buildItems = () => buildSocialItems(platforms, textColor, accentColor, fontSize);
    const items1 = buildItems();
    const items2 = buildItems();
    items1.forEach(i => iconsInner.appendChild(i));
    items2.forEach(i => iconsInner.appendChild(i));
  } else {
    iconsInner.style.cssText = 'display: flex; align-items: center; gap: 16px; flex-wrap: wrap;';
    buildSocialItems(platforms, textColor, accentColor, fontSize).forEach(i => iconsInner.appendChild(i));
  }

  iconsWrap.appendChild(iconsInner);
  bar.appendChild(iconsWrap);
  el.appendChild(bar);
}

function buildSocialItems(platforms, textColor, accentColor, fontSize) {
  return platforms.map(p => {
    const item = document.createElement('div');
    item.style.cssText = 'display: flex; align-items: center; gap: 6px; flex-shrink: 0;';

    const iconWrap = document.createElement('span');
    iconWrap.style.cssText = `color: ${accentColor}; display: flex; align-items: center; flex-shrink: 0;`;
    const platform = (p.platform || 'link').toLowerCase();
    iconWrap.innerHTML = SOCIAL_ICONS[platform] || SOCIAL_ICONS.link;
    item.appendChild(iconWrap);

    if (p.handle) {
      const handle = document.createElement('span');
      handle.textContent = p.handle;
      handle.style.cssText = `color: ${textColor}; font-size: ${fontSize}px; font-weight: 600;`;
      item.appendChild(handle);
    }

    return item;
  });
}

function renderTicker(el, config) {
  const bgColor = config.background_color || 'rgba(0, 0, 0, 0.75)';
  const textColor = config.text_color || '#ffffff';
  const accentColor = config.accent_color || '#9146ff';
  const fontSize = config.font_size || 16;
  const speed = config.speed || 'medium';
  const text = config.text || '';
  const separator = config.separator || '   •   ';

  const speedMap = { slow: '30s', medium: '20s', fast: '12s' };
  const duration = speedMap[speed] || speedMap.medium;

  el.style.cssText += '; overflow: hidden';

  const bar = document.createElement('div');
  bar.style.cssText = [
    `background: ${bgColor}`,
    `color: ${textColor}`,
    `font-size: ${fontSize}px`,
    'display: flex',
    'align-items: center',
    'overflow: hidden',
    'backdrop-filter: blur(4px)',
    '-webkit-backdrop-filter: blur(4px)',
  ].join('; ');

  if (config.label) {
    const label = document.createElement('div');
    label.textContent = config.label;
    label.style.cssText = [
      `background: ${accentColor}`,
      'color: #fff',
      'font-weight: 700',
      'font-size: 11px',
      'text-transform: uppercase',
      'letter-spacing: 2px',
      'padding: 8px 14px',
      'white-space: nowrap',
      'flex-shrink: 0',
      'z-index: 1',
    ].join('; ');
    bar.appendChild(label);
  }

  const ticker = document.createElement('div');
  ticker.style.cssText = 'overflow: hidden; flex: 1; padding: 8px 0;';

  // Repeat text for seamless scroll
  const repeated = [text, text].join(separator);

  const inner = document.createElement('div');
  inner.style.cssText = [
    'display: inline-block',
    'white-space: nowrap',
    `animation: scrollLeft ${duration} linear infinite`,
  ].join('; ');
  inner.textContent = repeated;

  ticker.appendChild(inner);
  bar.appendChild(ticker);
  el.appendChild(bar);
}

// ─── Remove Bar ────────────────────────────────────────────────────────────

function removeBar(overlayId, immediate) {
  const el = activeBars[overlayId];
  if (!el) return;

  delete activeBars[overlayId];

  if (immediate) {
    el.remove();
    return;
  }

  el.style.animation = 'fadeOut 0.4s ease-in forwards';
  setTimeout(() => el.remove(), 420);
}
