/**
 * Command palette (Ctrl/⌘+K): jump to any screen, or search vehicles, drivers, routes and stops.
 * Screens come from nav.js; entities are loaded lazily through the shared list cache.
 */
import { h, icon, matches } from './ui.js';
import { NAV } from './nav.js';
import { Lists } from './data.js';
import { navigate } from './router.js';

let open = false;

export async function openPalette() {
  if (open) return;
  open = true;
  const opener = document.activeElement;

  const input = h('input', { type: 'text', placeholder: 'Jump to a screen, or search vehicles, drivers, routes…', 'aria-label': 'Search', autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list' });
  const list = h('div', { class: 'palette-list', id: 'palette-list', role: 'listbox' });
  const overlay = h('div', { class: 'palette-overlay', onmousedown: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' },
      h('div', { class: 'palette-input' }, icon('search'), input, h('span', { class: 'kbd' }, 'Esc')), list));
  document.body.append(overlay);
  input.focus();

  const screens = NAV.flatMap((g) => g.items.map((i) => ({ kind: 'Screens', label: i.label, sub: g.group, icon: i.icon, hint: i.hint, run: () => navigate(i.path) })));
  let entities = [];
  let results = [];
  let sel = 0;

  // Entities load in the background; results refresh when they arrive.
  Promise.all([Lists.vehicles(), Lists.drivers(), Lists.routes(), Lists.stops()]).then(([vehicles, drivers, routes, stops]) => {
    entities = [
      ...vehicles.map((v) => ({ kind: 'Vehicles', label: v.vehicleNumber, sub: `${v.plateNumber}${v.assignedDriver ? ` · ${v.assignedDriver.name}` : ''}`, icon: 'bus', keys: [v.vehicleNumber, v.plateNumber, v.assignedDriver?.name], run: () => navigate(`/fleet/vehicles/${v.id}`) })),
      ...drivers.map((d) => ({ kind: 'Drivers', label: d.name, sub: d.licenseNumber, icon: 'idcard', keys: [d.name, d.licenseNumber, d.email, d.phone], run: () => navigate(`/fleet/drivers/${d.id}`) })),
      ...routes.map((r) => ({ kind: 'Routes', label: r.name, sub: `${r.stopCount} stops`, icon: 'route', keys: [r.name], run: () => navigate(`/fleet/routes/${r.id}`) })),
      ...stops.map((s) => ({ kind: 'Stops', label: s.name, sub: 'Stop', icon: 'pin', keys: [s.name], run: () => navigate('/fleet/stops') })),
    ];
    if (open) render();
  }).catch(() => { /* screens still work */ });

  function compute() {
    const q = input.value.trim();
    const sc = q ? screens.filter((s) => matches(q, s.label, s.sub, s.hint)) : screens;
    const en = q.length >= 2 ? entities.filter((e) => matches(q, ...e.keys)) : [];
    const grouped = [];
    for (const kind of ['Screens', 'Vehicles', 'Drivers', 'Routes', 'Stops']) {
      const rows = (kind === 'Screens' ? sc : en.filter((e) => e.kind === kind)).slice(0, kind === 'Screens' ? 8 : 5);
      if (rows.length) grouped.push([kind, rows]);
    }
    results = grouped.flatMap(([, rows]) => rows);
    return grouped;
  }

  function render() {
    const grouped = compute();
    sel = Math.min(sel, Math.max(0, results.length - 1));
    list.replaceChildren();
    if (!results.length) { list.append(h('div', { class: 'palette-group' }, 'No results'), h('p', { class: 'section-empty', style: { padding: '0 12px 12px' } }, 'Try a vehicle number, driver name or screen.')); return; }
    let idx = 0;
    for (const [kind, rows] of grouped) {
      list.append(h('div', { class: 'palette-group', role: 'presentation' }, kind));
      for (const r of rows) {
        const i = idx++;
        list.append(h('div', { class: `palette-item ${i === sel ? 'sel' : ''}`, role: 'option', 'aria-selected': i === sel ? 'true' : 'false', id: `pal-${i}`,
          onmousemove: () => { if (sel !== i) { sel = i; mark(); } }, onclick: () => choose(i) },
          icon(r.icon), h('span', {}, r.label), h('small', {}, r.sub)));
      }
    }
    input.setAttribute('aria-activedescendant', `pal-${sel}`);
  }

  function mark() {
    list.querySelectorAll('.palette-item').forEach((el, i) => { el.classList.toggle('sel', i === sel); el.setAttribute('aria-selected', i === sel ? 'true' : 'false'); });
    input.setAttribute('aria-activedescendant', `pal-${sel}`);
    list.querySelector('.palette-item.sel')?.scrollIntoView({ block: 'nearest' });
  }

  function choose(i) { const r = results[i]; close(); r?.run(); }

  function close() {
    if (!open) return;
    open = false;
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    if (opener && document.body.contains(opener)) opener.focus();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, results.length); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + results.length) % Math.max(1, results.length); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    else if (e.key === 'Tab') { e.preventDefault(); input.focus(); }
  }
  document.addEventListener('keydown', onKey, true);
  input.addEventListener('input', () => { sel = 0; render(); });
  render();
}
