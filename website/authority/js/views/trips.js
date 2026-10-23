/** Trips — `trips` with a `gps_logs` replay (map, polyline, time slider, play/pause). */
import { makeListView } from './_list.js';
import { Lists, TRIP_STATUSES } from '../data.js';
import { h, badge, kv, link, button, emptyState, fmtDateTime, fmtMoney, fmtNumber, titleCase, icon, reducedMotion } from '../ui.js';
import { createMap, fitTo } from '../maps.js';
import { navigate } from '../router.js';

const duration = (t) => {
  if (!t.endedAt) return t.status === 'in_progress' ? 'Running' : '—';
  const m = Math.max(0, Math.round((new Date(t.endedAt) - new Date(t.startedAt)) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

let replay = null;
const stopReplay = () => { replay?.destroy(); replay = null; };

/** Map + slider replay of a trip's GPS track. */
function buildReplay(track) {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2ee6c5';
  const mapEl = h('div', { class: 'map-box short' });
  const slider = h('input', { class: 'range', type: 'range', min: 0, max: track.length - 1, value: 0, 'aria-label': 'Replay position' });
  const readout = h('div', { class: 'text-sm', 'aria-live': 'off' });
  const playBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', 'aria-label': 'Play replay' }, icon('play', 'icon-sm'));
  const speedSel = h('select', { class: 'form-select', style: { width: '90px', padding: '6px 28px 6px 10px' }, 'aria-label': 'Replay speed' },
    ...[1, 2, 4, 8].map((x) => h('option', { value: x }, `${x}×`)));
  const root = h('div', {}, mapEl, h('div', { class: 'flex items-center gap-3 mt-3' }, playBtn, h('div', { class: 'grow' }, slider), speedSel), h('div', { class: 'mt-2' }, readout));

  const map = createMap(mapEl, { zoom: 13 });
  const pts = track.map((p) => [p.lat, p.lng]);
  L.polyline(pts, { color: accent, weight: 4, opacity: 0.25 }).addTo(map);
  const done = L.polyline([pts[0]], { color: accent, weight: 5, opacity: 0.95 }).addTo(map);
  const dot = L.circleMarker(pts[0], { radius: 8, color: '#fff', weight: 2, fillColor: accent, fillOpacity: 1 }).addTo(map);
  L.circleMarker(pts[0], { radius: 5, color: '#34d399', fillColor: '#34d399', fillOpacity: 1 }).addTo(map).bindTooltip('Start');
  L.circleMarker(pts[pts.length - 1], { radius: 5, color: '#f87171', fillColor: '#f87171', fillOpacity: 1 }).addTo(map).bindTooltip('End');
  setTimeout(() => { if (mapEl.isConnected) { map.invalidateSize(); fitTo(map, pts, { maxZoom: 15 }); } }, 450);

  let i = 0; let timer = null;
  const show = (n) => {
    i = n; slider.value = n;
    done.setLatLngs(pts.slice(0, n + 1)); dot.setLatLng(pts[n]);
    const p = track[n];
    readout.textContent = `${new Date(p.recordedAt).toLocaleTimeString()} · ${p.speed != null ? `${fmtNumber(p.speed, 0)} km/h` : 'speed n/a'} · point ${n + 1} of ${track.length}`;
  };
  const pause = () => { clearInterval(timer); timer = null; playBtn.replaceChildren(icon('play', 'icon-sm')); playBtn.setAttribute('aria-label', 'Play replay'); };
  const play = () => {
    if (i >= track.length - 1) show(0);
    playBtn.replaceChildren(icon('pause', 'icon-sm')); playBtn.setAttribute('aria-label', 'Pause replay');
    timer = setInterval(() => { if (i >= track.length - 1) { pause(); return; } show(i + 1); }, 600 / Number(speedSel.value));
  };
  playBtn.addEventListener('click', () => (timer ? pause() : play()));
  speedSel.addEventListener('change', () => { if (timer) { pause(); play(); } });
  slider.addEventListener('input', () => { if (timer) pause(); show(Number(slider.value)); });
  show(0);
  if (reducedMotion()) speedSel.value = '8';
  return { root, destroy: () => { pause(); map.remove(); } };
}

export default makeListView({
  title: 'Trips', subtitle: 'Every trip, newest first. Open one to replay its GPS track.', basePath: '/tracking/trips',
  searchPlaceholder: 'Search vehicle, driver, route…',
  chips: TRIP_STATUSES.map((s) => ({ key: s, label: titleCase(s) })), chipOf: (t) => t.status,
  searchOf: (t) => [t.vehicle.vehicleNumber, t.driver.name, t.route?.name],
  load: () => Api.get('/fleet/trips'),
  filterRow: (t, api) => {
    const { vehicleId, from, to } = api.extra;
    if (vehicleId && t.vehicle.id !== vehicleId) return false;
    const started = new Date(t.startedAt).getTime();
    if (from && started < new Date(`${from}T00:00:00`).getTime()) return false;
    if (to && started > new Date(`${to}T23:59:59`).getTime()) return false;
    return true;
  },
  toolbar: (api) => {
    const vehicleSel = h('select', { class: 'form-select', style: { width: '170px' }, 'aria-label': 'Filter by vehicle' }, h('option', { value: '' }, 'All vehicles'));
    Lists.vehicles().then((vs) => vs.forEach((v) => vehicleSel.append(h('option', { value: v.id }, v.vehicleNumber))));
    const set = (k) => (e) => { api.extra[k] = e.target.value; api.refresh(); };
    vehicleSel.addEventListener('change', set('vehicleId'));
    const from = h('input', { class: 'form-input', type: 'date', style: { width: '150px' }, 'aria-label': 'From date', onchange: set('from') });
    const to = h('input', { class: 'form-input', type: 'date', style: { width: '150px' }, 'aria-label': 'To date', onchange: set('to') });
    return [vehicleSel, from, to];
  },
  columns: () => [
    { key: 'startedAt', label: 'Started', sortable: true, render: (t) => h('span', { class: 'cell-main' }, fmtDateTime(t.startedAt)) },
    { key: 'vehicle', label: 'Vehicle', sortable: true, value: (t) => t.vehicle.vehicleNumber, render: (t) => t.vehicle.vehicleNumber },
    { key: 'driver', label: 'Driver', sortable: true, value: (t) => t.driver.name, render: (t) => t.driver.name },
    { key: 'route', label: 'Route', render: (t) => (t.route ? h('span', { class: 'truncate', style: { display: 'inline-block', maxWidth: '260px' }, title: t.route.name }, t.route.name) : h('span', { class: 'text-muted' }, 'No route')) },
    { key: 'duration', label: 'Duration', render: duration },
    { key: 'distanceKm', label: 'Distance', sortable: true, align: 'num', value: (t) => t.distanceKm ?? -1, render: (t) => (t.distanceKm === null ? '—' : `${fmtNumber(t.distanceKm, 1)} km`) },
    { key: 'estFuelLitres', label: 'Est. fuel', sortable: true, align: 'num', value: (t) => t.estFuelLitres ?? -1, render: (t) => (t.estFuelLitres === null ? '—' : `${fmtNumber(t.estFuelLitres, 1)} L`) },
    { key: 'estFuelCost', label: 'Est. fuel cost', sortable: true, align: 'num', value: (t) => t.estFuelCost ?? -1, render: (t) => fmtMoney(t.estFuelCost) },
    { key: 'status', label: 'Status', sortable: true, render: (t) => badge(t.status) },
  ],
  async openDetail({ id, api }) {
    const [trip, track] = await Promise.all([Api.get(`/fleet/trips/${id}`), Api.get(`/fleet/trips/${id}/track`)]);
    stopReplay();
    replay = track.length ? buildReplay(track) : null;
    api.drawer({
      title: `${trip.vehicle.vehicleNumber} · ${fmtDateTime(trip.startedAt)}`, subtitle: trip.route?.name || 'No route (on-demand trip)', badge: badge(trip.status),
      sections: [
        { heading: 'Summary', content: kv([
          ['Vehicle', link(trip.vehicle.vehicleNumber, () => navigate(`/fleet/vehicles/${trip.vehicle.id}`))],
          ['Driver', link(trip.driver.name, () => navigate(`/fleet/drivers/${trip.driver.id}`))],
          ['Route', trip.route ? link(trip.route.name, () => navigate(`/fleet/routes/${trip.route.id}`)) : null],
          ['Started', fmtDateTime(trip.startedAt)], ['Ended', trip.endedAt ? fmtDateTime(trip.endedAt) : 'In progress'],
          ['Duration', duration(trip)], ['GPS points', fmtNumber(trip.pointCount)],
          ['Distance', trip.distanceKm === null ? null : `${fmtNumber(trip.distanceKm, 2)} km`],
          ['Est. fuel used', trip.estFuelLitres === null ? 'Set the vehicle’s km/L to estimate' : `${fmtNumber(trip.estFuelLitres, 2)} L`],
          ['Est. fuel cost', trip.estFuelCost === null ? null : fmtMoney(trip.estFuelCost)]]) },
        { heading: 'GPS replay', content: replay ? replay.root : emptyState('No GPS points recorded for this trip', 'Replay appears once the vehicle reports positions during a trip.') },
      ],
    });
  },
  live: () => stopReplay,
});
