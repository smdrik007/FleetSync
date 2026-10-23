/**
 * Shared UI kit for the authority console. No framework: small DOM helpers + components.
 * Depends on globals from ../app.js (Toast, Theme).
 */

/* ═══════════════════════ DOM helpers ═══════════════════════ */

/** h('div', { class:'x', onclick:fn, dataset:{a:1} }, 'text', childNode, [more]) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class' || k === 'className') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Case-insensitive "does any value contain the query" used by list filters. */
export const matches = (q, ...vals) => !q || vals.some((v) => String(v ?? '').toLowerCase().includes(q.trim().toLowerCase()));

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ═══════════════════════ Icons (Lucide-style, 24px stroke) ═══════════════════════ */

const ICONS = {
  dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  bus: '<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  idcard: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16c.5-1.7 1.8-2.5 3-2.5s2.5.8 3 2.5"/><path d="M14 10h5"/><path d="M14 14h3"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  map: '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" x2="9" y1="3" y2="18"/><line x1="15" x2="15" y1="6" y2="21"/>',
  navigation: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  fuel: '<line x1="3" x2="15" y1="22" y2="22"/><line x1="4" x2="14" y1="9" y2="9"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  card: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  building: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  menu: '<path d="M4 12h16M4 6h16M4 18h16"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
};

export function icon(name, cls = '') {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;
  return wrap.firstChild;
}

/* ═══════════════════════ Formatting ═══════════════════════ */

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const fmtDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '—');
export const fmtDateTime = (iso) => (iso ? dateTimeFmt.format(new Date(iso)) : '—');
export const fmtMoney = (n) => (n === null || n === undefined ? '—' : `৳ ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);
export const fmtNumber = (n, d = 0) => (n === null || n === undefined ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
export const titleCase = (s) => String(s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function fmtRelative(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 0) return 'just now';
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return fmtDate(iso);
}

/** Whole days from today until a date (negative = past). */
export function daysUntil(iso) {
  const d = new Date(iso); const t = new Date();
  return Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())) / 86400000);
}

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

/* ═══════════════════════ Small components ═══════════════════════ */

export function badge(status, text) {
  const key = String(status ?? '').toLowerCase().replace(/[^a-z_]/g, '');
  return h('span', { class: `badge badge-dot badge-${key}` }, text ?? titleCase(status));
}

export function pageHead({ title, subtitle, count, actions = [] }) {
  return h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, title, count !== undefined ? h('span', { class: 'count-pill' }, String(count)) : null), subtitle ? h('p', { class: 'page-sub' }, subtitle) : null),
    h('div', { class: 'page-actions' }, ...actions));
}

export function button(label, { variant = 'outline', iconName, onClick, size = 'sm', title, disabled } = {}) {
  return h('button', { class: `btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''}`, type: 'button', onclick: onClick, title, disabled, 'aria-label': title || label },
    iconName ? icon(iconName, 'icon-sm') : null, label);
}

export function iconButton(iconName, title, onClick, variant = 'ghost') {
  return h('button', { class: `btn btn-${variant} btn-sm btn-icon`, type: 'button', title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); onClick(e); } }, icon(iconName, 'icon-sm'));
}

export function link(text, onClick) {
  return h('button', { class: 'link', type: 'button', onclick: (e) => { e.stopPropagation(); onClick(e); } }, text);
}

export function kv(pairs) {
  const dl = h('dl', { class: 'kv' });
  for (const [k, v] of pairs) dl.append(h('dt', {}, k), h('dd', {}, v === null || v === undefined || v === '' ? '—' : v));
  return dl;
}

export function miniList(items, { empty = 'Nothing here yet.' } = {}) {
  if (!items.length) return h('p', { class: 'section-empty' }, empty);
  return h('div', { class: 'mini-list' }, ...items);
}

export function miniRow(left, right, onClick) {
  return h('div', { class: `mini-row ${onClick ? 'clickable' : ''}`, onclick: onClick, tabindex: onClick ? 0 : undefined, onkeydown: onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined },
    h('div', { class: 'grow' }, left), right ? h('div', {}, right) : null);
}

export function skeleton(rows = 5) {
  return h('div', { class: 'table-card', 'aria-busy': 'true', 'aria-label': 'Loading' },
    h('div', { class: 'skeleton-rows' }, ...Array.from({ length: rows }, (_, i) => h('div', { class: 'skeleton', style: { width: `${95 - (i % 3) * 12}%` } }))));
}

export function emptyState(title, hint, actionEl) {
  return h('div', { class: 'empty-state' },
    h('div', { class: 'empty-state-icon' }, icon('info', 'icon-lg')),
    h('div', { class: 'empty-state-title' }, title),
    hint ? h('div', { class: 'empty-state-sub' }, hint) : null, actionEl || null);
}

export function errorState(err, retry) {
  const denied = err?.status === 403;
  return h('div', { class: 'card' }, h('div', { class: 'empty-state' },
    h('div', { class: 'empty-state-icon', style: { color: 'var(--red)' } }, icon(denied ? 'lock' : 'alert', 'icon-lg')),
    h('div', { class: 'empty-state-title' }, denied ? 'Access denied' : 'Something went wrong'),
    h('div', { class: 'empty-state-sub' }, err?.message || 'Unexpected error.'),
    retry && !denied ? button('Try again', { variant: 'primary', iconName: 'refresh', onClick: retry }) : null));
}

/** Count a number up to `to` (instant under reduced motion). */
export function animateCount(el, to, ms = 600, format = (n) => Math.round(n).toLocaleString()) {
  const target = Number(to) || 0;
  if (reducedMotion() || ms <= 0) { el.textContent = format(target); return; }
  const from = Number(el.dataset.v || 0);
  el.dataset.v = target;
  const run = (el._countRun = (el._countRun || 0) + 1);
  // Guarantee the final value even if animation frames are throttled (background tab, headless pane).
  setTimeout(() => { if (el._countRun === run) el.textContent = format(target); }, ms + 80);
  const t0 = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = format(from + (target - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function kpiCard({ label, value, iconName, tone = '', foot, format }) {
  const v = h('div', { class: 'kpi-value' }, '0');
  animateCount(v, value, 700, format);
  const foo = h('div', { class: 'kpi-foot' }, foot || '');
  const card = h('div', { class: `kpi ${tone}` }, h('div', { class: 'kpi-top' }, h('span', { class: 'kpi-label' }, label), h('span', { class: 'kpi-icon' }, icon(iconName))), v, foo);
  card.update = (nextValue, nextFoot) => { animateCount(v, nextValue, 500, format); if (nextFoot !== undefined) foo.textContent = nextFoot; };
  return card;
}

/* ═══════════════════════ Filter bar ═══════════════════════ */

/**
 * filterBar({ placeholder, chips:[{key,label}], onChange({q, chip}), actions:[Node] })
 * Returns the toolbar element; el.state = { q, chip }.
 */
export function filterBar({ placeholder = 'Search…', search = true, chips = [], onChange, actions = [] }) {
  const state = { q: '', chip: '' };
  const bar = h('div', { class: 'toolbar' });
  let timer;
  if (search) {
    const input = h('input', { class: 'form-input', type: 'search', placeholder, 'aria-label': placeholder });
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.q = input.value; onChange(state); }, 120); });
    bar.append(h('div', { class: 'search-box' }, icon('search', 'icon-sm'), input));
  }
  if (chips.length) {
    const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter' });
    const all = [{ key: '', label: 'All' }, ...chips];
    for (const c of all) {
      const b = h('button', { class: `chip ${c.key === '' ? 'active' : ''}`, type: 'button', 'aria-pressed': c.key === '' ? 'true' : 'false' }, c.label);
      b.addEventListener('click', () => {
        state.chip = c.key;
        wrap.querySelectorAll('.chip').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        onChange(state);
      });
      wrap.append(b);
    }
    bar.append(wrap);
  }
  if (actions.length) bar.append(h('div', { class: 'grow' }), ...actions);
  bar.state = state;
  return bar;
}

/* ═══════════════════════ Data table ═══════════════════════ */

/**
 * dataTable({ columns:[{key,label,render?(row),sortable?,align?,value?(row)}], rows, onRowClick?(row), pageSize=15, empty })
 * Returns a card element with .setRows(rows).
 */
export function dataTable({ columns, rows = [], onRowClick, pageSize = 15, empty = 'No records to show.' }) {
  let data = rows;
  let page = 1;
  let sort = { key: null, dir: 1 };

  const thead = h('thead', {}, h('tr', {}, ...columns.map((c) => {
    const th = h('th', { class: `${c.sortable ? 'sortable' : ''} ${c.align === 'num' ? 'num' : ''}`, scope: 'col', 'aria-sort': 'none' }, c.label, c.sortable ? h('span', { class: 'sort-ind' }, '↕') : null);
    if (c.sortable) th.addEventListener('click', () => {
      sort = { key: c.key, dir: sort.key === c.key ? -sort.dir : 1 };
      page = 1;
      thead.querySelectorAll('th').forEach((x) => { x.setAttribute('aria-sort', 'none'); const s = x.querySelector('.sort-ind'); if (s) s.textContent = '↕'; });
      th.setAttribute('aria-sort', sort.dir === 1 ? 'ascending' : 'descending');
      th.querySelector('.sort-ind').textContent = sort.dir === 1 ? '↑' : '↓';
      draw();
    });
    return th;
  })));
  const tbody = h('tbody');
  const pager = h('div', { class: 'pagination' });
  const card = h('div', { class: 'table-card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, thead, tbody)), pager);

  const sortValue = (col, row) => (col.value ? col.value(row) : row[col.key]);

  function draw() {
    let list = data;
    if (sort.key) {
      const col = columns.find((c) => c.key === sort.key);
      list = [...data].sort((a, b) => {
        const x = sortValue(col, a); const y = sortValue(col, b);
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir;
      });
    }
    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    page = Math.min(page, pages);
    const slice = list.slice((page - 1) * pageSize, page * pageSize);
    tbody.replaceChildren();
    if (!slice.length) {
      tbody.append(h('tr', {}, h('td', { colspan: columns.length }, emptyState(empty))));
    }
    for (const row of slice) {
      const tr = h('tr', { class: onRowClick ? 'clickable' : '', tabindex: onRowClick ? 0 : undefined });
      for (const c of columns) {
        const content = c.render ? c.render(row) : row[c.key];
        tr.append(h('td', { class: c.align === 'num' ? 'num' : '' }, content === null || content === undefined || content === '' ? '—' : content));
      }
      if (onRowClick) {
        tr.addEventListener('click', (e) => { if (!e.target.closest('button, a, input, select, .link')) onRowClick(row); });
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === tr) onRowClick(row); });
      }
      tbody.append(tr);
    }
    pager.replaceChildren();
    pager.classList.toggle('hidden', list.length <= pageSize);
    if (list.length > pageSize) {
      const from = (page - 1) * pageSize + 1; const to = Math.min(list.length, page * pageSize);
      pager.append(h('span', {}, `${from}–${to} of ${list.length}`),
        h('div', { class: 'flex gap-2' },
          h('button', { class: 'btn btn-outline btn-sm', type: 'button', disabled: page <= 1, 'aria-label': 'Previous page', onclick: () => { page -= 1; draw(); } }, icon('left', 'icon-sm')),
          h('span', { class: 'text-sm', style: { alignSelf: 'center' } }, `${page} / ${pages}`),
          h('button', { class: 'btn btn-outline btn-sm', type: 'button', disabled: page >= pages, 'aria-label': 'Next page', onclick: () => { page += 1; draw(); } }, icon('right', 'icon-sm'))));
    }
  }

  card.setRows = (next) => { data = next; page = 1; draw(); };
  draw();
  return card;
}

/* ═══════════════════════ Drawer ═══════════════════════ */

let drawerEl = null;
let backdropEl = null;
let drawerOpener = null;
let drawerOnClose = null;

function ensureDrawer() {
  if (drawerEl) return;
  backdropEl = h('div', { class: 'drawer-backdrop', onclick: () => closeDrawer() });
  drawerEl = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-hidden': 'true', tabindex: '-1' });
  document.body.append(backdropEl, drawerEl);
  document.addEventListener('keydown', (e) => {
    if (!drawerEl.classList.contains('open') || document.querySelector('.modal-overlay, .palette-overlay')) return;
    if (e.key === 'Escape') closeDrawer();
    if (e.key === 'Tab') trapFocus(e, drawerEl);
  });
}

function trapFocus(e, root) {
  const f = [...root.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
  if (!f.length) { e.preventDefault(); return; }
  const first = f[0]; const last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/**
 * openDrawer({ title, subtitle, badge, actions:[Node], sections:[{heading, content, action}], onClose })
 * Returns { body, setSections(sections), setTitle(t) }.
 */
export function openDrawer({ title, subtitle, badge: badgeEl, actions = [], sections = [], onClose } = {}) {
  ensureDrawer();
  if (!drawerEl.classList.contains('open')) drawerOpener = document.activeElement;
  drawerOnClose = onClose || null;
  const titleEl = h('h2', {}, title);
  const subEl = h('p', { class: 'page-sub' }, subtitle || '');
  const body = h('div', { class: 'drawer-body' });
  const head = h('div', { class: 'drawer-head' },
    h('div', { class: 'grow' }, titleEl, subEl, badgeEl ? h('div', { class: 'mt-2' }, badgeEl) : null, actions.length ? h('div', { class: 'flex gap-2 mt-3 wrap' }, ...actions) : null),
    h('button', { class: 'btn btn-ghost btn-sm btn-icon', type: 'button', 'aria-label': 'Close panel', onclick: () => closeDrawer() }, icon('x')));
  drawerEl.replaceChildren(head, body);
  const setSections = (list) => {
    body.replaceChildren(...list.map((s) => h('section', { class: 'drawer-section' },
      s.heading ? h('h4', {}, s.heading, s.action || null) : null, s.content)));
  };
  setSections(sections);
  drawerEl.setAttribute('aria-hidden', 'false');
  drawerEl.setAttribute('aria-label', title);
  backdropEl.classList.add('open');
  void drawerEl.offsetWidth; // flush styles so the slide-in transition runs without relying on rAF
  drawerEl.classList.add('open');
  drawerEl.focus();
  return { body, setSections, setTitle: (t) => { titleEl.textContent = t; } };
}

export function closeDrawer({ silent = false } = {}) {
  if (!drawerEl || !drawerEl.classList.contains('open')) return;
  drawerEl.classList.remove('open');
  backdropEl.classList.remove('open');
  drawerEl.setAttribute('aria-hidden', 'true');
  const cb = drawerOnClose; drawerOnClose = null;
  if (drawerOpener && document.body.contains(drawerOpener)) drawerOpener.focus();
  drawerOpener = null;
  if (!silent) cb?.();
}

export const isDrawerOpen = () => !!drawerEl?.classList.contains('open');

/* ═══════════════════════ Modal + forms ═══════════════════════ */

export function modalShell({ title, size = '', body, foot, onClose }) {
  const opener = document.activeElement;
  const overlay = h('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); if (opener && document.body.contains(opener)) opener.focus(); onClose?.(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') trapFocus(e, overlay);
  };
  const modal = h('div', { class: `modal ${size}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'btn btn-ghost btn-sm btn-icon', type: 'button', 'aria-label': 'Close dialog', onclick: close }, icon('x'))),
    body, foot);
  overlay.append(modal);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  return { overlay, modal, close };
}

/**
 * modalForm({ title, fields, initial, submitLabel, onSubmit(values), errorFields:{CODE:'field'}, size })
 * field: { name, label, type:'text|email|password|tel|number|date|textarea|select', required, options:[{value,label}], hint, placeholder, full, min, step }
 * Empty optional values are submitted as null. A thrown error keeps the dialog open: if err.code
 * is listed in errorFields the message is shown under that field, otherwise in a banner.
 */
export function modalForm({ title, fields, initial = {}, submitLabel = 'Save', onSubmit, errorFields = {}, size = '' }) {
  const inputs = {};
  const errors = {};
  const grid = h('div', { class: 'form-grid' });
  for (const f of fields) {
    let input;
    const val = initial[f.name] ?? '';
    if (f.type === 'select') {
      input = h('select', { class: 'form-select', name: f.name, id: `f-${f.name}` },
        ...(f.required ? [] : [h('option', { value: '' }, f.emptyLabel || 'None')]),
        ...(f.options || []).map((o) => h('option', { value: o.value }, o.label)));
      input.value = val === null ? '' : String(val);
      if (f.required && !input.value && f.options?.length) input.value = f.options[0].value;
    } else if (f.type === 'checkboxes') {
      const chosen = new Set(initial[f.name] || []);
      input = h('div', { class: 'checks', id: `f-${f.name}`, role: 'group', 'aria-label': f.label },
        ...(f.options || []).map((o) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: o.value, checked: chosen.has(o.value) }), o.label)));
      input.getValues = () => [...input.querySelectorAll('input:checked')].map((i) => i.value);
      input.focus = () => input.querySelector('input')?.focus();
    } else if (f.type === 'textarea') {
      input = h('textarea', { class: 'form-textarea', name: f.name, id: `f-${f.name}`, placeholder: f.placeholder, rows: 3 });
      input.value = val ?? '';
    } else {
      input = h('input', { class: 'form-input', type: f.type || 'text', name: f.name, id: `f-${f.name}`, placeholder: f.placeholder, min: f.min, max: f.max, step: f.step, autocomplete: f.type === 'password' ? 'new-password' : 'off' });
      input.value = f.type === 'date' && val ? String(val).slice(0, 10) : (val ?? '');
    }
    if (f.required) input.setAttribute('required', '');
    const err = h('div', { class: 'form-error hidden', role: 'alert' });
    errors[f.name] = err; inputs[f.name] = input;
    input.addEventListener('input', () => { input.classList.remove('invalid'); err.classList.add('hidden'); });
    grid.append(h('div', { class: `form-group ${f.full ? 'full' : ''}` },
      h('label', { class: 'form-label', for: `f-${f.name}` }, f.label, f.required ? ' *' : ''), input,
      f.hint ? h('div', { class: 'form-hint' }, f.hint) : null, err));
  }
  const banner = h('div', { class: 'alert alert-danger hidden', role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, submitLabel);
  const form = h('form', { novalidate: true }, h('div', { class: 'modal-body' }, banner, grid));
  let ctl;
  const cancel = h('button', { class: 'btn btn-outline', type: 'button', onclick: () => ctl.close() }, 'Cancel');
  const foot = h('div', { class: 'modal-foot' }, cancel, submit);
  form.append(foot);

  const showFieldError = (name, msg) => { inputs[name].classList.add('invalid'); errors[name].textContent = msg; errors[name].classList.remove('hidden'); inputs[name].focus(); };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    banner.classList.add('hidden');
    const values = {};
    for (const f of fields) {
      if (f.type === 'checkboxes') {
        const picked = inputs[f.name].getValues();
        if (f.required && !picked.length) { showFieldError(f.name, `Choose at least one ${f.label.toLowerCase()}.`); return; }
        values[f.name] = picked;
        continue;
      }
      const raw = inputs[f.name].value.trim();
      if (f.required && raw === '') { showFieldError(f.name, `${f.label} is required.`); return; }
      if (raw === '') values[f.name] = f.type === 'text' || f.type === 'textarea' ? (f.keepEmpty ? '' : null) : null;
      else if (f.type === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n)) { showFieldError(f.name, `${f.label} must be a number.`); return; }
        values[f.name] = n;
      } else values[f.name] = raw;
    }
    submit.disabled = true; submit.textContent = 'Saving…';
    try {
      await onSubmit(values);
      ctl.close();
    } catch (err) {
      const field = errorFields[err.code];
      if (field && inputs[field]) showFieldError(field, err.message);
      else { banner.textContent = err.message || 'Could not save.'; banner.classList.remove('hidden'); }
    } finally { submit.disabled = false; submit.textContent = submitLabel; }
  });

  ctl = modalShell({ title, size, body: form });
  // modalShell wraps head/body/foot; our form already holds body+foot
  setTimeout(() => (Object.values(inputs)[0])?.focus(), 30);
  return ctl;
}

export function confirmDialog(message, { confirmLabel = 'Delete', danger = true, title = 'Are you sure?' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const ok = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => { done(true); ctl.close(); } }, confirmLabel);
    const cancel = h('button', { class: 'btn btn-outline', type: 'button', onclick: () => ctl.close() }, 'Cancel');
    const ctl = modalShell({
      title, size: 'modal-sm', onClose: () => done(false),
      body: h('div', { class: 'modal-body' }, h('p', {}, message)), foot: h('div', { class: 'modal-foot' }, cancel, ok),
    });
    setTimeout(() => (danger ? cancel : ok).focus(), 30);
  });
}

/** Run an async mutation with toast feedback; returns true on success. */
export async function mutate(promise, successMessage) {
  try {
    const r = await promise;
    if (successMessage) Toast.success(successMessage);
    return r === undefined ? true : r;
  } catch (err) {
    Toast.error(err.message || 'Request failed.');
    return false;
  }
}

/* ═══════════════════════ Charts (Chart.js) ═══════════════════════ */

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
const liveCharts = new Set();

function themeChart(chart) {
  const text = cssVar('muted'); const grid = cssVar('border');
  const o = chart.options;
  if (o.scales) for (const s of Object.values(o.scales)) { s.ticks = { ...(s.ticks || {}), color: text }; s.grid = { ...(s.grid || {}), color: grid, drawBorder: false }; }
  if (o.plugins?.legend?.labels) o.plugins.legend.labels.color = cssVar('text-2');
  chart.data.datasets.forEach((ds, i) => {
    const tok = chart._tokens?.[i];
    if (tok === undefined) return;
    if (Array.isArray(tok)) ds.backgroundColor = tok.map(cssVar);
    else { ds.borderColor = cssVar(tok); ds.backgroundColor = chart.config.type === 'line' ? `color-mix(in srgb, ${cssVar(tok)} 18%, transparent)` : cssVar(tok); }
  });
  chart.update('none');
}
window.addEventListener('fs:theme', () => { setTimeout(() => liveCharts.forEach(themeChart), 30); });

function makeChart(canvas, type, { labels, datasets, options = {} }) {
  const chart = new Chart(canvas, {
    type, data: { labels, datasets: datasets.map((d) => ({ ...d })) },
    options: {
      responsive: true, maintainAspectRatio: false, animation: reducedMotion() ? false : { duration: 600 },
      plugins: { legend: { display: datasets.length > 1 || type === 'doughnut', position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } } },
      ...options,
    },
  });
  chart._tokens = datasets.map((d) => d.color ?? d.colors);
  liveCharts.add(chart);
  const destroy = chart.destroy.bind(chart);
  chart.destroy = () => { liveCharts.delete(chart); destroy(); };
  themeChart(chart);
  return chart;
}

export function lineChart(canvas, data) {
  return makeChart(canvas, 'line', { ...data, datasets: data.datasets.map((d) => ({ tension: 0.35, fill: true, pointRadius: 2, borderWidth: 2, ...d })),
    options: { scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } } });
}
export function barChart(canvas, data) {
  return makeChart(canvas, 'bar', { ...data, datasets: data.datasets.map((d) => ({ borderRadius: 6, maxBarThickness: 36, ...d })),
    options: { scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } } });
}
export function doughnutChart(canvas, { labels, data, colors }) {
  return makeChart(canvas, 'doughnut', { labels, datasets: [{ data, colors, borderWidth: 0 }], options: { cutout: '68%', plugins: { legend: { display: false } } } });
}
