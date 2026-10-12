/**
 * Dashboard — one `/fleet/dashboard/summary` call drives every KPI and chart;
 * WebSocket events refresh it live (debounced) with a 60 s fallback.
 */
import {
  h, pageHead, kpiCard, button, badge, miniList, miniRow, emptyState, icon, link,
  fmtMoney, fmtDate, fmtRelative, daysUntil, titleCase, barChart, lineChart, doughnutChart, closeDrawer,
} from '../ui.js';
import { createMap, vehicleMarker, fitTo, tip } from '../maps.js';
import { navigate } from '../router.js';

const STATUS_COLORS = { idle: 'accent', on_trip: 'green', maintenance: 'amber', offline: 'slate', retired: 'purple' };
const short = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const monthLabel = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' });
const greeting = () => { const hr = new Date().getHours(); return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; };
const shortLabel = (name = '') => (name.includes('#') ? name.split('#').pop() : name).replace(/\s+/g, '').slice(0, 3).toUpperCase();

let S = null;

export default {
  title: 'Dashboard',

  async render(ctx) {
    dispose();   // never leave a previous render's timers / sockets behind
    const [summary, positions] = await Promise.all([Api.get('/fleet/dashboard/summary'), Api.get('/fleet/positions')]);
    S = { id: ctx.renderId, summary, charts: {}, timers: [], handlers: [], map: null, markers: new Map(), updatedAt: Date.now(), alive: true, positions };

    const me = Auth.user() || {};
    const updated = h('span', { class: 'text-muted' });
    const paintUpdated = () => { updated.textContent = `Updated ${fmtRelative(new Date(S.updatedAt).toISOString())}`; };
    paintUpdated();
    S.timers.push(setInterval(paintUpdated, 15000));

    const kpis = {
      vehicles: kpiCard({ label: 'Vehicles', value: summary.totalVehicles, iconName: 'bus', foot: '' }),
      trips: kpiCard({ label: 'Active trips', value: summary.activeTrips, iconName: 'navigation', tone: 'green', foot: 'Running right now' }),
      devices: kpiCard({ label: 'Devices online', value: summary.devices.online, iconName: 'cpu', tone: 'purple', foot: '' }),
      fuel: kpiCard({ label: 'Fuel, last 30 days', value: summary.fuelCost30d, iconName: 'fuel', tone: 'amber', format: (n) => fmtMoney(Math.round(n)), foot: 'Across all vehicles' }),
    };
    S.kpis = kpis;

    const canvases = { status: h('canvas', { 'aria-label': 'Fleet status breakdown' }), trips: h('canvas', { 'aria-label': 'Trips per day' }), fuel: h('canvas', { 'aria-label': 'Fuel cost per week' }), maint: h('canvas', { 'aria-label': 'Maintenance cost by month' }) };
    S.canvases = canvases;
    const centerTotal = h('strong', {}, '0'); S.centerTotal = centerTotal;
    const legend = h('div', { class: 'legend mt-3' }); S.legend = legend;
    S.upcoming = h('div'); S.licenses = h('div');
    S.mapEl = h('div', { class: 'map-box short' });

    const card = (title, body, action) => h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, title), action || null), body);

    const root = h('div', {},
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Dashboard'), h('p', { class: 'greeting' }, `${greeting()}, ${(me.name || '').split(' ')[0] || 'there'}. Here is your fleet right now.`)),
        h('div', { class: 'page-actions flex items-center gap-3' }, updated, button('Refresh', { iconName: 'refresh', onClick: () => refresh(true) }))),
      h('div', { class: 'grid-4 mb-4' }, kpis.vehicles, kpis.trips, kpis.devices, kpis.fuel),
      h('div', { class: 'grid-12 mb-4' },
        card('Fleet status', h('div', {}, h('div', { class: 'donut-wrap' }, canvases.status, h('div', { class: 'donut-center' }, centerTotal, h('span', {}, 'vehicles'))), legend)),
        card('Trips per day', h('div', { class: 'chart-box', style: { height: '270px' } }, canvases.trips), h('span', { class: 'text-muted' }, 'Last 14 days'))),
      h('div', { class: 'grid-2 mb-4' },
        card('Fuel cost per week', h('div', { class: 'chart-box' }, canvases.fuel), h('span', { class: 'text-muted' }, 'Last 8 weeks')),
        card('Maintenance cost by month', h('div', { class: 'chart-box' }, canvases.maint), h('span', { class: 'text-muted' }, 'Last 6 months'))),
      h('div', { class: 'grid-3' },
        card('Upcoming maintenance', S.upcoming, link('View all', () => navigate('/operations/maintenance'))),
        card('Licenses expiring', S.licenses, link('Drivers', () => navigate('/fleet/drivers'))),
        card('Live positions', S.mapEl, link('Open live map', () => navigate('/tracking/map')))));

    paintLists(summary);
    paintKpiFoots(summary);
    return root;
  },

  /** Charts and the map need real layout, so they are created once the view is in the page. */
  mounted() {
    if (!S) return;
    const { summary, canvases } = S;
    const statusKeys = Object.keys(summary.vehiclesByStatus);
    S.charts.status = doughnutChart(canvases.status, { labels: statusKeys.map(titleCase), data: statusKeys.map((k) => summary.vehiclesByStatus[k]), colors: statusKeys.map((k) => STATUS_COLORS[k]) });
    S.charts.trips = lineChart(canvases.trips, { labels: summary.tripsPerDay.map((d) => short(d.date)), datasets: [{ label: 'Trips', data: summary.tripsPerDay.map((d) => d.count), color: 'accent' }] });
    S.charts.fuel = barChart(canvases.fuel, { labels: summary.fuelCostPerWeek.map((w) => short(w.weekStart)), datasets: [{ label: 'Fuel cost (৳)', data: summary.fuelCostPerWeek.map((w) => w.cost), color: 'amber' }] });
    S.charts.maint = barChart(canvases.maint, { labels: summary.maintenanceCostByMonth.map((m) => monthLabel(m.month)), datasets: [{ label: 'Maintenance cost (৳)', data: summary.maintenanceCostByMonth.map((m) => m.cost), color: 'purple' }] });
    paintLegend(summary);

    S.map = createMap(S.mapEl, { zoom: 12 });
    const layer = L.layerGroup().addTo(S.map);
    S.layer = layer;
    const draw = (positions) => {
      layer.clearLayers(); S.markers.clear();
      positions.forEach((p) => {
        const m = vehicleMarker([p.lat, p.lng], { label: shortLabel(p.vehicleNumber), status: p.status, stale: p.isStale, live: !p.isStale && p.status === 'on_trip' }).bindTooltip(tip(p.vehicleNumber)).addTo(layer);
        m.on('click', () => navigate(`/tracking/map?focus=${p.vehicleId}`));
        S.markers.set(p.vehicleId, m);
      });
      fitTo(S.map, positions.map((p) => [p.lat, p.lng]), { maxZoom: 14 });
    };
    S.drawMap = draw;
    draw(S.positions);
    setTimeout(() => { if (S?.map && S.mapEl.isConnected) { S.map.invalidateSize(); draw(S.positions); } }, 450);

    // ── live refresh ───────────────────────────────────────────────
    let t;
    const soon = () => { clearTimeout(t); t = setTimeout(() => refresh(false), 1000); };
    const on = (e, fn) => { WsManager.on(e, fn); S.handlers.push([e, fn]); };
    ['trip.started', 'trip.ended', 'vehicle.status_changed'].forEach((e) => on(e, soon));
    on('location.update', (d) => { const m = S.markers.get(d.vehicleId); if (m) m.setLatLng([d.latitude, d.longitude]); });
    S.timers.push(setInterval(() => refresh(false), 60000));
    S.timers.push({ clear: () => clearTimeout(t) });
  },

  destroy(renderId) {
    if (renderId !== undefined && S?.id !== renderId) return;   // a stale render finishing late must not touch the current one
    dispose();
  },
};

function dispose() {
  {
    if (!S) return;
    S.alive = false;
    S.handlers.forEach(([e, fn]) => WsManager.off(e, fn));
    S.timers.forEach((x) => (x.clear ? x.clear() : clearInterval(x)));
    Object.values(S.charts).forEach((c) => c?.destroy());
    S.map?.remove();
    closeDrawer({ silent: true });
    S = null;
  }
}

/* ───────────── painting helpers ───────────── */

function paintKpiFoots(s) {
  const v = s.vehiclesByStatus;
  S.kpis.vehicles.update(s.totalVehicles, `${v.on_trip} on trip · ${v.idle} idle · ${v.maintenance} in maintenance`);
  S.kpis.trips.update(s.activeTrips);
  S.kpis.devices.update(s.devices.online, `of ${Object.values(s.devices).reduce((a, b) => a + b, 0) - s.devices.online} registered${s.devices.faulty ? ` · ${s.devices.faulty} faulty` : ''}`);
  S.kpis.fuel.update(s.fuelCost30d);
}

function paintLegend(s) {
  const keys = Object.keys(s.vehiclesByStatus);
  S.centerTotal.textContent = String(s.totalVehicles);
  S.legend.replaceChildren(...keys.map((k) => h('span', {}, h('i', { style: { background: `var(--${STATUS_COLORS[k] === 'slate' ? 'slate' : STATUS_COLORS[k]})` } }), `${titleCase(k)} · ${s.vehiclesByStatus[k]}`)));
}

function paintLists(s) {
  S.upcoming.replaceChildren(miniList(s.upcomingMaintenance.map((m) => miniRow(
    h('div', {}, h('div', { class: 'cell-main' }, m.description), h('div', { class: 'cell-sub' }, `${m.vehicleNumber} · ${fmtDate(m.serviceDate)}`)),
    h('span', { class: 'badge badge-blue' }, daysUntil(m.serviceDate) <= 0 ? 'Today' : `in ${daysUntil(m.serviceDate)}d`), () => navigate('/operations/maintenance'))), { empty: 'Nothing scheduled.' }));
  S.licenses.replaceChildren(miniList(s.licenseExpiring.map((d) => {
    const days = daysUntil(d.licenseExpiry);
    return miniRow(h('div', {}, h('div', { class: 'cell-main' }, d.name), h('div', { class: 'cell-sub' }, fmtDate(d.licenseExpiry))),
      h('span', { class: `badge badge-${days < 0 ? 'red' : 'amber'}` }, days < 0 ? `Expired ${-days}d ago` : `${days}d left`), () => navigate(`/fleet/drivers/${d.driverId}`));
  }), { empty: 'All licenses are valid for 30+ days.' }));
}

async function refresh(manual) {
  if (!S?.alive) return;
  try {
    const [summary, positions] = await Promise.all([Api.get('/fleet/dashboard/summary'), Api.get('/fleet/positions')]);
    if (!S?.alive) return;
    S.summary = summary; S.updatedAt = Date.now(); S.positions = positions;
    paintKpiFoots(summary); paintLists(summary); paintLegend(summary);
    const { status, trips, fuel, maint } = S.charts;
    const keys = Object.keys(summary.vehiclesByStatus);
    if (status) { status.data.datasets[0].data = keys.map((k) => summary.vehiclesByStatus[k]); status.update(); }
    if (trips) { trips.data.datasets[0].data = summary.tripsPerDay.map((d) => d.count); trips.update(); }
    if (fuel) { fuel.data.datasets[0].data = summary.fuelCostPerWeek.map((w) => w.cost); fuel.update(); }
    if (maint) { maint.data.datasets[0].data = summary.maintenanceCostByMonth.map((m) => m.cost); maint.update(); }
    S.drawMap?.(positions);
    if (manual) Toast.success('Dashboard refreshed.');
  } catch (err) { if (manual) Toast.error(err.message); }
}
