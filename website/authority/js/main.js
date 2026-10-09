/**
 * Authority console bootstrap: auth guard, shell wiring (sidebar, topbar, bell, theme),
 * route registration, WebSocket connection.
 */
import * as ui from './ui.js';
import { registerRoute, startRouter, navigate } from './router.js';
import { NAV, ROUTES, loaderFor, findNav } from './nav.js';

const { h, icon, initials, fmtRelative } = ui;
const $ = (id) => document.getElementById(id);

if (!Auth.require('AUTHORITY')) throw new Error('redirecting to login');
const me = Auth.user() || {};

/* ───────────── Sidebar ───────────── */
const nav = $('nav');
for (const g of NAV) {
  nav.append(h('div', { class: 'nav-group' },
    h('div', { class: 'nav-group-label' }, g.group),
    ...g.items.map((item) => h('a', { class: 'nav-item', href: `#${item.path}`, dataset: { path: item.path }, title: item.label }, icon(item.icon, 'nav-icon'), h('span', {}, item.label)))));
}

function markActive(path) {
  nav.querySelectorAll('.nav-item').forEach((a) => {
    const on = path === a.dataset.path || path.startsWith(`${a.dataset.path}/`);
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

function setCrumbs(path, view) {
  const found = findNav(path);
  const c = $('crumbs');
  c.replaceChildren();
  if (!found) { c.append(h('strong', {}, view?.title || 'FleetSync')); return; }
  c.append(h('span', {}, found.group), h('span', { class: 'sep' }, '/'),
    path === found.item.path ? h('strong', {}, found.item.label) : h('a', { href: `#${found.item.path}` }, found.item.label));
  if (path !== found.item.path) c.append(h('span', { class: 'sep' }, '/'), h('strong', {}, 'Details'));
}

/* collapse / mobile menu */
const shell = $('shell');
const COLLAPSE_KEY = 'fs_sidebar_collapsed';
try { if (localStorage.getItem(COLLAPSE_KEY) === '1') shell.classList.add('collapsed'); } catch { /* storage blocked */ }
$('collapse-icon').append(icon('panel'));
$('collapse-btn').addEventListener('click', () => {
  const on = shell.classList.toggle('collapsed');
  try { localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  $('collapse-btn').setAttribute('aria-label', on ? 'Expand sidebar' : 'Collapse sidebar');
});
$('menu-btn').append(icon('menu'));
$('menu-btn').addEventListener('click', () => shell.classList.add('menu-open'));
$('scrim').addEventListener('click', () => shell.classList.remove('menu-open'));
nav.addEventListener('click', (e) => { if (e.target.closest('a')) shell.classList.remove('menu-open'); });

/* ───────────── Topbar ───────────── */
$('search-icon').append(icon('search', 'icon-sm'));
const openPalette = () => import('./palette.js').then((m) => m.openPalette()).catch((e) => console.warn('palette unavailable', e));
$('search-btn').addEventListener('click', openPalette);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
});

function paintTheme() {
  const btn = $('theme-btn');
  btn.replaceChildren(icon(Theme.current() === 'light' ? 'moon' : 'sun'));
  btn.setAttribute('aria-label', Theme.current() === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
}
$('theme-btn').addEventListener('click', () => Theme.toggle());
window.addEventListener('fs:theme', paintTheme);
paintTheme();

function paintWs(status) {
  const on = status === 'connected';
  $('ws-dot').className = `dot-live ${on ? '' : 'warn'}`;
  $('ws-text').textContent = on ? 'Live' : 'Reconnecting';
}
WsManager.on('status', paintWs);
paintWs(WsManager.status);

$('user-avatar').textContent = initials(me.name);
$('user-name').textContent = me.name || 'Account';

/* dropdown menus */
function wireMenu(btnId, menuId, build) {
  const btn = $(btnId); const menu = $(menuId);
  const close = () => { menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const open = menu.classList.contains('hidden');
    document.querySelectorAll('.menu').forEach((m) => m.classList.add('hidden'));
    if (open) { await build(menu); menu.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true'); }
  });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

wireMenu('user-btn', 'user-menu', (menu) => {
  menu.replaceChildren(
    h('div', { class: 'menu-head' }, h('div', {}, h('div', {}, me.name), h('small', { class: 'text-muted' }, me.email))),
    h('button', { class: 'menu-item', type: 'button', onclick: () => { navigate('/admin/institution'); } }, icon('building', 'icon-sm'), 'Institution settings'),
    h('button', { class: 'menu-item', type: 'button', onclick: logout }, icon('logout', 'icon-sm'), 'Sign out'));
});

async function logout() {
  try { await Api.post('/auth/logout'); } catch { /* token may already be invalid */ }
  Auth.clear();
  location.href = '/index.html';
}

/* ───────────── Notification bell ───────────── */
$('bell-icon').append(icon('bell'));
let bellItems = [];

function paintBadge(count) {
  const b = $('bell-badge');
  b.textContent = count > 99 ? '99+' : String(count);
  b.classList.toggle('hidden', count === 0);
}

export async function refreshUnread() {
  try {
    const d = await Api.get('/fleet/notifications');
    bellItems = d.items.slice(0, 5);
    paintBadge(d.unreadCount);
  } catch { /* leave the previous badge */ }
}

wireMenu('bell-btn', 'bell-menu', async (menu) => {
  await refreshUnread();
  menu.replaceChildren(
    h('div', { class: 'menu-head' }, 'Notifications',
      h('button', { class: 'link', type: 'button', onclick: async () => { await Api.post('/fleet/notifications/read-all'); await refreshUnread(); menu.classList.add('hidden'); window.dispatchEvent(new Event('fs:notifications-changed')); } }, 'Mark all read')),
    ...(bellItems.length
      ? bellItems.map((n) => h('button', { class: `menu-item ${n.isRead ? '' : 'unread'}`, type: 'button', onclick: async () => { if (!n.isRead) await Api.post(`/fleet/notifications/${n.id}/read`); await refreshUnread(); menu.classList.add('hidden'); navigate('/operations/notifications'); } },
        h('div', {}, h('strong', {}, n.title), h('small', {}, `${n.message.slice(0, 80)} · ${fmtRelative(n.createdAt)}`))))
      : [h('div', { class: 'menu-item' }, 'You are all caught up.')]),
    h('button', { class: 'menu-item', type: 'button', onclick: () => { menu.classList.add('hidden'); navigate('/operations/notifications'); } }, 'View all notifications'));
});

WsManager.on('notification.new', (n) => { Toast.info(n.title); refreshUnread(); });
window.addEventListener('fs:notifications-changed', refreshUnread);

/* institution chip */
const paintInstitution = (inst) => {
  $('inst-name').textContent = inst.name;
  $('inst-slug').textContent = inst.slug;
  $('inst-avatar').textContent = initials(inst.name);
};
Api.get('/fleet/institution').then(paintInstitution).catch(() => { $('inst-name').textContent = 'Your institution'; });
window.addEventListener('fs:institution-changed', (e) => paintInstitution(e.detail));

/* ───────────── Router ───────────── */
for (const [pattern, name] of ROUTES) registerRoute(pattern, loaderFor(name));

WsManager.connect();
refreshUnread();
startRouter($('view'), { api: Api, ws: WsManager, ui }, {
  home: '/overview/dashboard',
  onChange: ({ path, view }) => { markActive(path); setCrumbs(path, view); },
});
