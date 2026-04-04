'use strict';

const root = document.getElementById('overlay-root');
const maxMessages = parseInt(getSetting('maxMessages', '15'));
const fadeTime = parseInt(getSetting('fadeTime', '60')) * 1000; // 0 = never fade

root.innerHTML = `<div class="chat-container"><div class="chat-messages" id="chat-messages"></div></div>`;

const messagesEl = document.getElementById('chat-messages');
const messages = [];

// Platform SVG icons
const platformIcons = {
  twitch: '<svg class="chat-platform twitch" viewBox="0 0 24 24" fill="currentColor"><path d="M11.64 5.93h1.43v4.28h-1.43m3.93-4.28H17v4.28h-1.43M7 2L3.43 5.57v12.86h4.28V22l3.58-3.57h2.85L20.57 12V2m-1.43 9.29l-2.85 2.85h-2.86l-2.5 2.5v-2.5H7.71V3.43h11.43z"/></svg>',
  youtube: '<svg class="chat-platform youtube" viewBox="0 0 24 24" fill="currentColor"><path d="M10 15l5.19-3L10 9v6m11.56-7.83c.13.47.22 1.1.28 1.9.07.8.1 1.49.1 2.09L22 12c0 2.19-.16 3.8-.44 4.83-.25.9-.83 1.48-1.73 1.73-.47.13-1.33.22-2.65.28-1.3.07-2.49.1-3.59.1L12 19c-4.19 0-6.8-.16-7.83-.44-.9-.25-1.48-.83-1.73-1.73-.13-.47-.22-1.1-.28-1.9-.07-.8-.1-1.49-.1-2.09L2 12c0-2.19.16-3.8.44-4.83.25-.9.83-1.48 1.73-1.73.47-.13 1.33-.22 2.65-.28 1.3-.07 2.49-.1 3.59-.1L12 5c4.19 0 6.8.16 7.83.44.9.25 1.48.83 1.73 1.73z"/></svg>',
  kick: '<svg class="chat-platform kick" viewBox="0 0 24 24" fill="currentColor"><path d="M6 3h4v6l4-6h4l-5 7.5L18 18h-4l-4-6v6H6V3z"/></svg>',
};

function addMessage(platform, username, text, color) {
  const msg = document.createElement('div');
  msg.className = 'chat-msg';
  msg.innerHTML = `${platformIcons[platform] || platformIcons.twitch}<span class="chat-username" style="color:${color || '#9146ff'}">${escapeHtml(username)}</span><span class="chat-text">${escapeHtml(text)}</span>`;
  messagesEl.appendChild(msg);
  messages.push({ el: msg, time: Date.now() });

  // Remove excess messages
  while (messages.length > maxMessages) {
    const old = messages.shift();
    old.el.remove();
  }

  // Auto-scroll
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Fade old messages
if (fadeTime > 0) {
  setInterval(() => {
    const now = Date.now();
    messages.forEach(m => {
      if (now - m.time > fadeTime && !m.fading) {
        m.fading = true;
        m.el.classList.add('fading');
        setTimeout(() => {
          m.el.remove();
          const idx = messages.indexOf(m);
          if (idx >= 0) messages.splice(idx, 1);
        }, 500);
      }
    });
  }, 1000);
}

// Connect to Atleta SSE for chat events
const token = window.OVERLAY_TOKEN;
if (token) {
  const evtSource = new EventSource(`/overlay/events/${token}`);
  evtSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'chat') {
        addMessage(data.data.platform || 'twitch', data.data.username, data.data.message, data.data.color);
      }
    } catch (e) {}
  };
  evtSource.onerror = () => {
    console.log('[Chat Overlay] SSE connection error, will retry...');
  };
}

console.log('[Chat Overlay] Ready');
