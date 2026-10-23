/**
 * FleetSync — Shared JS runtime (classic script; exposes globals)
 * Auth · Api · WsManager · Theme · Toast · route/format helpers
 */

/* ═══════════════════════════════════════════════════════════════════
   ENDPOINTS — same origin when served by Express, localhost fallback for file:// use
   ═══════════════════════════════════════════════════════════════════ */
const API_BASE = location.host ? `${location.origin}/api/v1` : 'http://localhost:3000/api/v1';
const WS_BASE  = location.host
  ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
  : 'ws://localhost:3000/ws';

/* ═══════════════════════════════════════════════════════════════════
   THEME — dark (default) / light, remembered per browser
   ═══════════════════════════════════════════════════════════════════ */
const Theme = {
  _key: 'fs_theme',
  current() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  },
  _apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    window.dispatchEvent(new CustomEvent('fs:theme', { detail: theme }));
  },
  init() {
    let saved = null;
    try { saved = localStorage.getItem(this._key); } catch { /* storage blocked */ }
    this._apply(saved === 'light' ? 'light' : 'dark'); // dark unless the user chose light
  },
  toggle() {
    const next = this.current() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(this._key, next); } catch { /* storage blocked */ }
    this._apply(next);
  },
};
Theme.init();

/* ═══════════════════════════════════════════════════════════════════
   REVEAL — cards/stats fade-and-rise as they scroll into view.
   Views render dynamically, so a MutationObserver tags new nodes.
   ═══════════════════════════════════════════════════════════════════ */
(function reveal() {
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const SEL = '.card, .stat-card, .m-card';
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
  const tag = (el) => {
    if (el.nodeType !== 1 || el.closest('.modal, .drawer')) return;
    const nodes = el.matches(SEL) ? [el, ...el.querySelectorAll(SEL)] : [...el.querySelectorAll(SEL)];
    nodes.forEach((n, i) => {
      if (n.classList.contains('reveal') || n.closest('.modal, .drawer')) return;
      n.style.setProperty('--rv-d', `${Math.min(i, 6) * 45}ms`);
      n.classList.add('reveal'); io.observe(n);
    });
  };
  const start = () => {
    tag(document.body);
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(tag))).observe(document.body, { childList: true, subtree: true });
    // topbar gets a soft shadow once the page has scrolled
    addEventListener('scroll', () => document.documentElement.classList.toggle('scrolled', scrollY > 4), { passive: true });
  };
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', start) : start();
})();

/* ═══════════════════════════════════════════════════════════════════
   AUTH
   ═══════════════════════════════════════════════════════════════════ */
const Auth = {
  /** Store token + user in localStorage */
  save(token, user) {
    localStorage.setItem('fs_token', token);
    localStorage.setItem('fs_user',  JSON.stringify(user));
  },
  token()      { return localStorage.getItem('fs_token'); },
  user()       { try { return JSON.parse(localStorage.getItem('fs_user')); } catch { return null; } },
  clear()      { localStorage.removeItem('fs_token'); localStorage.removeItem('fs_user'); },
  isLoggedIn() { return !!this.token(); },
  role()       { return this.user()?.role; },

  /** Redirect to login if not authenticated, or if wrong role */
  require(expectedRole) {
    if (!this.isLoggedIn()) { window.location.href = '/index.html'; return false; }
    if (expectedRole && this.role() !== expectedRole) {
      const map = { AUTHORITY: '/authority/index.html', DRIVER: '/driver/index.html', PASSENGER: '/passenger/index.html', GUARDIAN: '/guardian/index.html' };
      window.location.href = map[this.role()] || '/index.html';
      return false;
    }
    return true;
  },
};

/* ═══════════════════════════════════════════════════════════════════
   API CLIENT
   ═══════════════════════════════════════════════════════════════════ */
const Api = {
  async _req(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (Auth.token()) headers['Authorization'] = `Bearer ${Auth.token()}`;
    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch {
      const err = new Error('Cannot reach the server. Check your connection and try again.');
      err.code = 'NETWORK';
      throw err;
    }
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON body */ }

    // Expired / invalid session → back to login (but not for the login call itself)
    if (res.status === 401 && path !== '/auth/login') {
      Auth.clear();
      window.location.href = '/index.html';
    }
    if (!res.ok || !json?.success) {
      const err = new Error(json?.error?.message || `Request failed (${res.status})`);
      err.code   = json?.error?.code;
      err.status = res.status;
      throw err;
    }
    return json.data;
  },
  get(path)        { return this._req('GET',    path); },
  post(path, body) { return this._req('POST',   path, body ?? {}); },
  put(path, body)  { return this._req('PUT',    path, body ?? {}); },
  delete(path)     { return this._req('DELETE', path); },
  /** Build a query string, skipping empty values: Api.get('/x' + Api.qs({ status: 'idle' })) */
  qs(params = {}) {
    const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    return q ? `?${q}` : '';
  },
};

/* ═══════════════════════════════════════════════════════════════════
   WEBSOCKET MANAGER
   ═══════════════════════════════════════════════════════════════════ */
const WsManager = {
  _ws:         null,
  _handlers:   {},   // { eventName: [fn, ...] }
  _reconnDelay:1000,
  _watchedVehicles: new Set(),
  _status:     'reconnecting',

  /** 'connected' | 'reconnecting' */
  get status() { return this._status; },

  _setStatus(s) {
    if (this._status === s) return;
    this._status = s;
    (this._handlers['status'] || []).forEach((fn) => fn(s));
  },

  connect() {
    const token = Auth.token();
    if (!token || this._ws) return;
    this._ws = new WebSocket(`${WS_BASE}?token=${token}`);

    this._ws.onopen = () => {
      this._reconnDelay = 1000;
      this._setStatus('connected');
      // Re-subscribe to watched vehicles after reconnect
      this._watchedVehicles.forEach((id) => this.watchVehicle(id));
    };

    this._ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      (this._handlers[msg.event] || []).forEach((fn) => fn(msg.data));
    };

    this._ws.onerror = () => { /* onclose follows */ };

    this._ws.onclose = () => {
      this._ws = null;
      this._setStatus('reconnecting');
      if (!Auth.isLoggedIn()) return;
      setTimeout(() => {
        this._reconnDelay = Math.min(this._reconnDelay * 2, 15000); // exponential backoff
        this.connect();
      }, this._reconnDelay);
    };
  },

  on(event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
  },

  off(event, fn) {
    if (!this._handlers[event]) return;
    this._handlers[event] = this._handlers[event].filter((h) => h !== fn);
  },

  send(payload) {
    if (this._ws?.readyState === WebSocket.OPEN) this._ws.send(JSON.stringify(payload));
  },

  watchVehicle(vehicleId) {
    this._watchedVehicles.add(vehicleId);
    this.send({ action: 'watch_vehicle', vehicleId });
  },

  unwatchVehicle(vehicleId) {
    this._watchedVehicles.delete(vehicleId);
    this.send({ action: 'unwatch_vehicle', vehicleId });
  },
};

/* ═══════════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS  (text only — messages may carry server text)
   ═══════════════════════════════════════════════════════════════════ */
const Toast = {
  _container: null,

  _getContainer() {
    if (!this._container) {
      this._container = document.getElementById('toast-container');
      if (!this._container) {
        this._container = document.createElement('div');
        this._container.id = 'toast-container';
        this._container.setAttribute('aria-live', 'polite');
        document.body.appendChild(this._container);
      }
    }
    return this._container;
  },

  show(message, type = 'info', duration = 4000) {
    const glyphs = { success: '✓', error: '!', warning: '!', info: 'i' };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const g = document.createElement('span'); g.className = 'toast-glyph'; g.textContent = glyphs[type] || 'i';
    const m = document.createElement('span'); m.textContent = message;
    t.append(g, m);
    this._getContainer().appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0'; t.style.transform = 'translateX(110%)'; t.style.transition = 'all .3s';
      setTimeout(() => t.remove(), 300);
    }, duration);
  },

  success(msg) { this.show(msg, 'success'); },
  error(msg)   { this.show(msg, 'error', 6000); },
  info(msg)    { this.show(msg, 'info'); },
  warning(msg) { this.show(msg, 'warning'); },
};

/* ═══════════════════════════════════════════════════════════════════
   ROUTE PARSER — "Stop A → Stop B → Stop C" → array of stops
   FR-PAS-03
   ═══════════════════════════════════════════════════════════════════ */
function parseRoute(routeText) {
  if (!routeText || !routeText.trim()) return [];
  // Split on →, -->, or comma (FR-POOL-02)
  return routeText.split(/\s*(?:-->|→|,)\s*/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Render a visual stepper into a container element.
 * @param {HTMLElement} container
 * @param {string[]}    stops
 * @param {number}      currentIndex  (-1 = not started)
 */
function renderStepper(container, stops, currentIndex = -1) {
  container.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'stepper';

  stops.forEach((stop, i) => {
    const dot = document.createElement('span');
    const label = document.createElement('span');

    if (currentIndex === -1) {
      dot.className   = 'step-dot pending';
      label.className = 'step-label pending';
    } else if (i < currentIndex) {
      dot.className   = 'step-dot passed';
      label.className = 'step-label passed';
    } else if (i === currentIndex) {
      dot.className   = 'step-dot current';
      label.className = 'step-label current';
    } else {
      dot.className   = 'step-dot';
      label.className = 'step-label';
    }
    label.textContent = stop;

    const stopWrap = document.createElement('span');
    stopWrap.style.cssText = 'display:flex;align-items:center;gap:4px;';
    stopWrap.appendChild(dot);
    stopWrap.appendChild(label);
    el.appendChild(stopWrap);

    if (i < stops.length - 1) {
      const line = document.createElement('span');
      line.className = i < currentIndex ? 'step-line passed' : 'step-line';
      el.appendChild(line);
    }
  });

  container.appendChild(el);
}

/**
 * Badge HTML for a schema status value (idle | on_trip | maintenance | offline | retired …).
 * Accepts legacy upper-case values too.
 */
function statusBadge(status) {
  const key = String(status || '').toLowerCase();
  const label = key.replace(/_/g, ' ');
  const safe = label.replace(/[^a-z ]/g, '');
  return `<span class="badge badge-dot badge-${key.replace(/[^a-z_]/g, '')}">${safe}</span>`;
}

/** Format ISO date to a short local time. */
function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
