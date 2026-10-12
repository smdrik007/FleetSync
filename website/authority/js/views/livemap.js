/** Live Map — `vehicle_latest_position`, moved in real time by WebSocket `location.update` events. */
import { h, badge, pageHead, filterBar, emptyState, fmtRelative, fmtNumber, matches, titleCase } from '../ui.js';
import { createMap, vehicleMarker, fitTo, tip } from '../maps.js';
import { openVehicleDrawer } from './vehicles.js';
import { closeDrawer } from '../ui.js';

const STALE_MS = 5 * 60 * 1000;
let S = null; // per-render state, cleared in destroy()

const shortLabel = (name = '') => (name.includes('#') ? name.split('#').pop() : name).replace(/\s+/g, '').slice(0, 3).toUpperCase() || '?';
const isStale = (iso) => Date.now() - new Date(iso).getTime() > STALE_MS;

function paintMarker(entry) {
  const stale = isStale(entry.recordedAt);
  entry.marker.setIcon(vehicleMarker([entry.lat, entry.lng], { label: shortLabel(entry.vehicleNumber), status: entry.status, stale, live: !stale && entry.status === 'on_trip' }).options.icon);
  entry.marker.setTooltipContent(tip(`${entry.vehicleNumber} · ${entry.speed != null ? `${fmtNumber(entry.speed, 0)} km/h` : 'speed n/a'} · ${fmtRelative(entry.recordedAt)}`));
}

export default {
  title: 'Live Map',

  async render(ctx) {
    dispose();
    const [positions, vehicles] = await Promise.all([Api.get('/fleet/positions'), Api.get('/fleet/vehicles')]);
    const entries = new Map(); // vehicleId → { ...position, marker }
    const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
    S = { id: ctx.renderId, entries, timers: [], handlers: [], map: null, selected: ctx.query.focus || null, filter: { q: '', chip: '' } };

    const mapEl = h('div', { class: 'map-box tall' });
    const listEl = h('div', { class: 'vehicle-list' });
    const summary = h('p', { class: 'page-sub' });
    const headSlot = h('div', {}, pageHead({ title: 'Live Map', subtitle: ' ' }));

    const map = createMap(mapEl, { zoom: 12 });
    S.map = map;
    const layer = L.layerGroup().addTo(map);

    function upsert(p) {
      let e = entries.get(p.vehicleId);
      if (!e) {
        e = { ...p, marker: null };
        e.marker = vehicleMarker([p.lat, p.lng], { label: shortLabel(p.vehicleNumber), status: p.status }).bindTooltip(tip(''), { direction: 'top', offset: [0, -14] }).addTo(layer);
        e.marker.on('click', () => select(p.vehicleId, { pan: false }));
        entries.set(p.vehicleId, e);
      } else Object.assign(e, p);
      e.marker.setLatLng([e.lat, e.lng]);
      paintMarker(e);
    }

    function paintSummary() {
      const all = [...entries.values()];
      const stale = all.filter((e) => isStale(e.recordedAt)).length;
      const live = all.length - stale;
      const noSignal = vehicles.filter((v) => !entries.has(v.id)).length;
      summary.textContent = `${live} live · ${stale} stale · ${noSignal} with no signal`;
    }

    function paintList() {
      const { q, chip } = S.filter;
      const rows = vehicles.filter((v) => matches(q, v.vehicleNumber, v.plateNumber, v.assignedDriver?.name)
        && (!chip || (chip === 'live' && entries.has(v.id) && !isStale(entries.get(v.id).recordedAt)) || (chip === 'nosignal' && (!entries.has(v.id) || isStale(entries.get(v.id).recordedAt)))));
      listEl.replaceChildren(...(rows.length ? rows.map((v) => {
        const e = entries.get(v.id);
        const stale = e && isStale(e.recordedAt);
        return h('div', { class: `vehicle-item ${S.selected === v.id ? 'sel' : ''}`, tabindex: 0, role: 'button', 'aria-label': `Show ${v.vehicleNumber} on the map`,
          onclick: () => select(v.id, { pan: true }), onkeydown: (ev) => { if (ev.key === 'Enter') select(v.id, { pan: true }); } },
          h('i', { class: `dot-live ${e && !stale ? '' : 'off'}` }),
          h('div', { class: 'grow' }, h('div', { class: 'cell-main' }, v.vehicleNumber), h('div', { class: 'cell-sub' }, e ? `${stale ? 'Last seen' : 'Updated'} ${fmtRelative(e.recordedAt)}${e.speed != null && !stale ? ` · ${fmtNumber(e.speed, 0)} km/h` : ''}` : 'No position yet')),
          badge(v.currentStatus));
      }) : [emptyState('No vehicles match')]));
    }

    function select(id, { pan }) {
      S.selected = id;
      const e = entries.get(id);
      if (e && pan) { map.setView([e.lat, e.lng], Math.max(map.getZoom(), 15)); e.marker.openTooltip(); }
      paintList();
      openVehicleDrawer(id, { onClose: () => { S.selected = null; paintList(); } }).catch((err) => Toast.error(err.message));
    }

    positions.forEach(upsert);
    paintSummary(); paintList();
    fitTo(map, positions.map((p) => [p.lat, p.lng]), { maxZoom: 14 });
    setTimeout(() => { if (mapEl.isConnected && !S.userMoved) { map.invalidateSize(); fitTo(map, [...entries.values()].map((e) => [e.lat, e.lng]), { maxZoom: 14 }); } }, 450);
    map.on('dragstart zoomstart', () => { S.userMoved = true; });

    const bar = filterBar({ placeholder: 'Search vehicles…', chips: [{ key: 'live', label: 'Live' }, { key: 'nosignal', label: 'No signal' }],
      onChange: (s) => { S.filter = { q: s.q, chip: s.chip }; paintList(); } });

    // ── live updates ────────────────────────────────────────────────
    const on = (event, fn) => { WsManager.on(event, fn); S.handlers.push([event, fn]); };
    on('location.update', (d) => {
      const known = vehicleById.get(d.vehicleId);
      if (!known) return;
      upsert({ vehicleId: d.vehicleId, vehicleNumber: known.vehicleNumber, status: 'on_trip', lat: d.latitude, lng: d.longitude, speed: d.speed, heading: d.heading, recordedAt: d.timestamp, tripId: d.tripId, isStale: false });
      paintSummary(); paintList();
    });
    let refetch;
    const refresh = () => { clearTimeout(refetch); refetch = setTimeout(async () => {
      try {
        const [pos, vs] = await Promise.all([Api.get('/fleet/positions'), Api.get('/fleet/vehicles')]);
        if (!S) return;
        vs.forEach((v) => vehicleById.set(v.id, v));
        vehicles.splice(0, vehicles.length, ...vs);
        const live = new Set(pos.map((p) => p.vehicleId));
        for (const [id, e] of entries) if (!live.has(id)) { layer.removeLayer(e.marker); entries.delete(id); }
        pos.forEach(upsert); paintSummary(); paintList();
      } catch { /* keep the current picture */ }
    }, 600); };
    ['trip.started', 'trip.ended', 'vehicle.status_changed'].forEach((e) => on(e, refresh));
    S.timers.push(setInterval(() => { entries.forEach(paintMarker); paintSummary(); paintList(); }, 30000)); // re-evaluate staleness

    const root = h('div', {}, headSlot, summary, bar, h('div', { class: 'split' }, listEl, mapEl));
    headSlot.replaceChildren(pageHead({ title: 'Live Map', count: vehicles.length }));
    if (S.selected) setTimeout(() => select(S.selected, { pan: true }), 500);
    return root;
  },

  destroy(renderId) {
    if (renderId !== undefined && S?.id !== renderId) return;   // a stale render finishing late must not touch the current one
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
