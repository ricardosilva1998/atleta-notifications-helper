// Tip goal overlay — progress bar, separate OBS browser source (/overlay/goal/:token)
let serverVersion = null;
let evtSource = null;
let reconnectTimer = null;
let currentGoalId = null;
let displayedAmount = 0;
let countAnim = null;

const root = document.getElementById('goal-root');

function formatMoney(value, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'EUR' }).format(value);
  } catch (e) {
    return (currency || '') + ' ' + Number(value).toFixed(2);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function connectSSE() {
  if (evtSource) { evtSource.close(); evtSource = null; }

  evtSource = new EventSource(`/overlay/goal/events/${window.OVERLAY_TOKEN}`);

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

    if (data.type === 'tip_goal') {
      renderGoal(data.goal, data);
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

function buildCard(goal) {
  root.innerHTML = `
    <div class="goal-card">
      <div class="goal-accent"></div>
      <div class="goal-header">
        <span class="goal-title"></span>
        <span class="goal-amounts"><span class="goal-current"></span><span class="goal-sep"> / </span><span class="goal-target"></span></span>
      </div>
      <div class="goal-track">
        <div class="goal-fill"><div class="goal-shine"></div></div>
        <div class="goal-pct"></div>
        <div class="goal-flag"></div>
      </div>
    </div>`;
  currentGoalId = goal.id;
  displayedAmount = goal.current;
}

function animateAmount(to, currency) {
  const el = root.querySelector('.goal-current');
  if (!el) return;
  if (countAnim) cancelAnimationFrame(countAnim);
  const from = displayedAmount;
  const start = performance.now();
  const duration = 1200;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    displayedAmount = from + (to - from) * eased;
    el.textContent = formatMoney(displayedAmount, currency);
    if (t < 1) countAnim = requestAnimationFrame(step);
    else { displayedAmount = to; countAnim = null; }
  };
  countAnim = requestAnimationFrame(step);
}

function renderGoal(goal, event) {
  if (!goal) {
    root.innerHTML = '';
    currentGoalId = null;
    return;
  }

  if (goal.id !== currentGoalId || !root.querySelector('.goal-card')) buildCard(goal);

  const card = root.querySelector('.goal-card');
  card.style.setProperty('--goal-color', goal.barColor || '#22c55e');
  card.classList.toggle('completed', !!goal.completed);

  root.querySelector('.goal-title').innerHTML = (goal.completed ? '🏁 ' : '') + escapeHtml(goal.title);
  root.querySelector('.goal-target').textContent = formatMoney(goal.target, goal.currency);
  root.querySelector('.goal-pct').textContent = goal.completed ? 'GOAL REACHED!' : Math.floor(goal.percent) + '%';
  root.querySelector('.goal-fill').style.width = Math.max(goal.percent, goal.current > 0 ? 2 : 0) + '%';
  animateAmount(goal.current, goal.currency);

  if (event && event.added) showIncrement(event.added, goal.currency);
  if (event && event.justCompleted) celebrate();
}

function showIncrement(amount, currency) {
  const card = root.querySelector('.goal-card');
  if (!card) return;
  card.classList.remove('bump');
  void card.offsetWidth; // restart the animation
  card.classList.add('bump');

  const pop = document.createElement('div');
  pop.className = 'goal-pop';
  pop.textContent = '+' + formatMoney(amount, currency);
  card.appendChild(pop);
  setTimeout(() => pop.remove(), 2200);
}

function celebrate() {
  const card = root.querySelector('.goal-card');
  if (!card) return;
  card.classList.add('celebrate');
  const colors = ['#ffffff', '#111111', getComputedStyle(card).getPropertyValue('--goal-color').trim() || '#22c55e', '#facc15'];
  for (let i = 0; i < 40; i++) {
    const p = document.createElement('div');
    p.className = 'goal-confetti';
    p.style.left = (Math.random() * 100) + '%';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = (Math.random() * 0.4) + 's';
    p.style.setProperty('--dx', ((Math.random() - 0.5) * 160) + 'px');
    p.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
    card.appendChild(p);
    setTimeout(() => p.remove(), 2600);
  }
  setTimeout(() => card.classList.remove('celebrate'), 4000);
}

connectSSE();
