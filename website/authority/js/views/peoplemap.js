/** People Map: every tracked person on one map, a search box to find and select one, live via `asset.location`. */
import { h, pageHead, filterBar, emptyState, badge, fmtRelative, matches, initials, closeDrawer } from '../ui.js';
import { createMap, vehicleMarker, fitTo, tip } from '../maps.js';
import { openPersonDrawer, updateOpenPersonDrawer } from './people.js';

let S = null;   // per-render state, cleared in dispose()

const STALE_MS = 5 * 60 * 1000;
const staleAfter = (p) => Math.max(STALE_MS, 3000 * (p.device?.reportingIntervalS || 0));

const markerOf = (p) => vehicleMarker([p.position.lat, p.position.lng], {
  label: initials(p.name), status: p.position.sos ? 'maintenance' : 'on_trip', stale: !!p.position.isStale, live: !p.position.isStale && !p.position.sos,
});

const statusText = (p) => (p.trackingPaused ? 'Tracking paused' : !p.consentAt ? 'Consent needed' : !p.position ? 'No position yet'
  : `${p.position.sos ? 'SOS · ' : ''}${p.position.isStale ? 'Last seen' : 'Updated'} ${fmtRelative(p.position.recordedAt)}${p.position.batteryPct != null ? ` · ${Math.round(p.position.batteryPct)}%` : ''}`);

export default {
  title: 'People Map',

  async render(ctx) {
    dispose();
    const people = await Api.get('/fleet/people');
    S = { id: ctx.renderId, byId: new Map(people.map((p) => [p.id, p])), markers: new Map(), handlers: [], timers: [], map: null, selected: ctx.query.focus || null, filter: { q: '', chip: '' }, moved: false };

    const mapEl = h('div', { class: 'map-box tall' });
    const listEl = h('div', { class: 'vehicle-list' });
    const summary = h('p', { class: 'page-sub' });
    const map = createMap(mapEl, { zoom: 12 });
    S.map = map;
    const layer = L.layerGroup().addTo(map);

    const paintMarker = (p) => {
      let m = S.markers.get(p.id);
      if (!p.position) { if (m) { layer.removeLayer(m); S.markers.delete(p.id); } return; }
      if (!m) {
        m = L.marker([p.position.lat, p.position.lng], { icon: markerOf(p).options.icon }).bindTooltip(tip(p.name), { direction: 'top', offset: [0, -14] }).addTo(layer);
        m.on('click', () => select(p.id, { pan: false }));
        S.markers.set(p.id, m);
      }
      m.setLatLng([p.position.lat, p.position.lng]);
      m.setIcon(markerOf(p).options.icon);
      m.setTooltipContent(tip(`${p.name} · ${statusText(p)}`));
    };

    const all = () => [...S.byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    const isLive = (p) => !!p.position && !p.position.isStale && !p.trackingPaused;

    function paintSummary() {
      const list = all();
      const live = list.filter(isLive).length;
      const sos = list.filter((p) => p.position?.sos).length;
      summary.textContent = `${live} live · ${list.filter((p) => p.position && !isLive(p)).length} stale or paused · ${list.filter((p) => !p.position).length} with no position${sos ? ` · ${sos} SOS` : ''}`;
    }

    function paintList() {
      const { q, chip } = S.filter;
      const rows = all().filter((p) => matches(q, p.name, p.code, p.id, p.notes, ...(p.guardians || []).map((g) => g.name))
        && (!chip || (chip === 'live' && isLive(p)) || (chip === 'nosignal' && !isLive(p)) || (chip === 'sos' && p.position?.sos)));
      listEl.replaceChildren(...(rows.length ? rows.map((p) => h('div', { class: `vehicle-item ${S.selected === p.id ? 'sel' : ''}`, tabindex: 0, role: 'button', 'aria-label': `Locate ${p.name} on the map`,
        onclick: () => select(p.id, { pan: true }), onkeydown: (ev) => { if (ev.key === 'Enter') select(p.id, { pan: true }); } },
        h('i', { class: `dot-live ${isLive(p) ? '' : 'off'}` }),
        h('div', { class: 'grow' }, h('div', { class: 'cell-main' }, p.name), h('div', { class: 'cell-sub' }, `${p.code ? `ID ${p.code} · ` : ''}${statusText(p)}`)),
        p.position?.sos ? badge('faulty', 'SOS') : null)) : [emptyState(S.byId.size ? 'No one matches' : 'No one tracked yet', S.byId.size ? 'Try a different name or ID.' : 'Add people on the People screen.')]));
    }

    function select(id, { pan }) {
      S.selected = id;
      const p = S.byId.get(id);
      if (p?.position && pan) { map.setView([p.position.lat, p.position.lng], Math.max(map.getZoom(), 16)); S.markers.get(id)?.openTooltip(); }
      else if (p && !p.position) Toast.info(`${p.name} has no position yet.`);
      paintList();
      openPersonDrawer(id, { onClose: () => { S.selected = null; paintList(); } }).catch((err) => Toast.error(err.message));
    }

    people.forEach(paintMarker);
    paintSummary(); paintList();
    const fitAll = () => fitTo(map, [...S.byId.values()].filter((p) => p.position).map((p) => [p.position.lat, p.position.lng]), { maxZoom: 15 });
    fitAll();
    setTimeout(() => { if (mapEl.isConnected && !S.moved) { map.invalidateSize(); fitAll(); } }, 450);
    map.on('dragstart zoomstart', () => { S.moved = true; });

    const bar = filterBar({ placeholder: 'Search by name or ID number…', chips: [{ key: 'live', label: 'Live' }, { key: 'nosignal', label: 'No signal' }, { key: 'sos', label: 'SOS' }],
      onChange: (s) => { S.filter = { q: s.q, chip: s.chip }; paintList(); } });
    // Enter in the search box locates the only match.
    bar.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.matches('input')) return;
      const hits = all().filter((p) => matches(S.filter.q, p.name, p.code, p.id));
      if (hits.length === 1) select(hits[0].id, { pan: true });
    });

    // Live: a fix moves the marker; an unknown person (newly added) triggers a refetch.
    const on = (event, fn) => { WsManager.on(event, fn); S.handlers.push([event, fn]); };
    let timer;
    function refetch() {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const fresh = await Api.get('/fleet/people');
          if (!S) return;
          S.byId = new Map(fresh.map((p) => [p.id, p]));
          for (const [id, m] of S.markers) if (!S.byId.get(id)?.position) { layer.removeLayer(m); S.markers.delete(id); }
          fresh.forEach(paintMarker); paintSummary(); paintList();
        } catch { /* keep the current picture */ }
      }, 600);
    }
    on('asset.location', (d) => {
      const p = S.byId.get(d.assetId);
      if (!p) { refetch(); return; }
      p.position = { lat: d.latitude, lng: d.longitude, speed: d.speed, batteryPct: d.batteryPct, sos: !!d.sos, recordedAt: d.timestamp, isStale: false };
      paintMarker(p); paintSummary(); paintList();
      updateOpenPersonDrawer(d);
    });
    // Staleness ages without any event, and consent, pause and new people changes are picked up now and then.
    S.timers.push(setInterval(() => {
      all().forEach((p) => { if (p.position) { p.position.isStale = Date.now() - new Date(p.position.recordedAt).getTime() > staleAfter(p); paintMarker(p); } });
      paintSummary(); paintList();
    }, 30000));
    S.timers.push(setInterval(refetch, 120000));

    const root = h('div', {}, pageHead({ title: 'People Map', subtitle: 'Everyone being tracked, live. Search to find and select one person.', count: people.length }), summary, bar, h('div', { class: 'split' }, listEl, mapEl));
    if (S.selected) setTimeout(() => select(S.selected, { pan: true }), 500);
    return root;
  },

  destroy(renderId) {
    if (renderId !== undefined && S?.id !== renderId) return;   // a late stale render must not touch the current one
    dispose();
  },
};

function dispose() {
  if (!S) return;
  S.handlers.forEach(([e, fn]) => WsManager.off(e, fn));
  S.timers.forEach(clearInterval);
  S.map?.remove();
  closeDrawer({ silent: true });
  S = null;
}
