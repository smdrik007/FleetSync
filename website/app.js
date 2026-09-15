/**
 * FleetSync — Shared JS Utilities
 * API client, Auth helpers, WebSocket manager, Toast, Route parser
 */

const API_BASE = 'http://localhost:3000/api/v1';
const WS_BASE  = 'ws://localhost:3000/ws';

/* ═══════════════════════════════════════════════════════════════════
   AUTH
   ═══════════════════════════════════════════════════════════════════ */
const Auth = {
  /** Store token + user in localStorage */
  save(token, user) {
    localStorage.setItem('fs_token', token);
    localStorage.setItem('fs_user',  JSON.stringify(user));
  },
  token()     { return localStorage.getItem('fs_token'); },
  user()      { try { return JSON.parse(localStorage.getItem('fs_user')); } catch { return null; } },
  clear()     { localStorage.removeItem('fs_token'); localStorage.removeItem('fs_user'); },
  isLoggedIn(){ return !!this.token(); },
  role()      { return this.user()?.role; },

  /** Redirect to login if not authenticated, or if wrong role */
  require(expectedRole) {
    if (!this.isLoggedIn()) { window.location.href = '/index.html'; return false; }
    if (expectedRole && this.role() !== expectedRole) {
      const map = { AUTHORITY: '/authority/index.html', DRIVER: '/driver/index.html', PASSENGER: '/passenger/index.html' };
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
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      const err = new Error(json.error?.message || 'Request failed');
      err.code   = json.error?.code;
      err.status = res.status;
      throw err;
    }
    return json.data;
  },
  get(path)          { return this._req('GET',    path); },
  post(path, body)   { return this._req('POST',   path, body); },
  put(path, body)    { return this._req('PUT',    path, body); },
  delete(path)       { return this._req('DELETE', path); },
};

/* ═══════════════════════════════════════════════════════════════════
   WEBSOCKET MANAGER
   ═══════════════════════════════════════════════════════════════════ */
const WsManager = {
  _ws:         null,
  _handlers:   {},   // { eventName: [fn, ...] }
  _reconnDelay:1000,
  _watchedVehicles: new Set(),

  connect() {
    const token = Auth.token();
    if (!token) return;
    this._ws = new WebSocket(`${WS_BASE}?token=${token}`);

    this._ws.onopen  = () => {
      console.log('[WS] Connected');
      this._reconnDelay = 1000;
      // Re-subscribe to watched vehicles after reconnect
      this._watchedVehicles.forEach((id) => this.watchVehicle(id));
    };

    this._ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      const handlers = this._handlers[msg.event] || [];
      handlers.forEach((fn) => fn(msg.data));
    };

    this._ws.onerror = (e) => console.warn('[WS] Error', e);

    this._ws.onclose = () => {
      console.log(`[WS] Closed — reconnecting in ${this._reconnDelay}ms`);
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
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(payload));
    }
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
   TOAST NOTIFICATIONS
   ═══════════════════════════════════════════════════════════════════ */
const Toast = {
  _container: null,

  _getContainer() {
    if (!this._container) {
      this._container = document.getElementById('toast-container');
      if (!this._container) {
        this._container = document.createElement('div');
        this._container.id = 'toast-container';
        document.body.appendChild(this._container);
      }
    }
    return this._container;
  },

  show(message, type = 'info', duration = 4000) {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
    this._getContainer().appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(110%)'; t.style.transition = 'all .3s'; setTimeout(() => t.remove(), 300); }, duration);
  },

  success(msg) { this.show(msg, 'success'); },
  error(msg)   { this.show(msg, 'error'); },
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
 * Return badge HTML for a vehicle status.
 */
function statusBadge(status) {
  const map = {
    ACTIVE:      '<span class="badge badge-green">ACTIVE</span>',
    ON_TRIP:     '<span class="badge badge-amber">ON_TRIP</span>',
    MAINTENANCE: '<span class="badge badge-red">MAINTENANCE</span>',
    INACTIVE:    '<span class="badge badge-muted">INACTIVE</span>',
  };
  return map[status] || `<span class="badge badge-muted">${status}</span>`;
}

/**
 * Format ISO date to human readable.
 */
function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
