/**
 * Costs — what the institution actually spent: fuel logs + maintenance, per vehicle and per month,
 * next to the distance driven. One `/fleet/costs` call, filtered by dates and vehicle.
 * Trip fuel estimates (Trips page) are not part of these totals: they estimate fuel that the logs already record.
 */
import { Lists } from '../data.js';
import { h, pageHead, kpiCard, dataTable, emptyState, link, fmtMoney, fmtNumber, barChart } from '../ui.js';
import { navigate } from '../router.js';

const monthLabel = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

let S = null;

const query = (f) => Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

export default {
  title: 'Costs',

  async render(ctx) {
    dispose();
    const me = S = { id: ctx.renderId, filters: { from: '', to: '', vehicleId: '' }, chart: null };

    const set = (k) => (e) => { S.filters[k] = e.target.value; load(); };
    const vehicleSel = h('select', { class: 'form-select', style: { width: '170px' }, 'aria-label': 'Filter by vehicle', onchange: set('vehicleId') }, h('option', { value: '' }, 'All vehicles'));
    Lists.vehicles().then((vs) => vs.forEach((v) => vehicleSel.append(h('option', { value: v.id }, v.vehicleNumber))));
    const from = h('input', { class: 'form-input', type: 'date', style: { width: '150px' }, 'aria-label': 'From date', onchange: set('from') });
    const to = h('input', { class: 'form-input', type: 'date', style: { width: '150px' }, 'aria-label': 'To date', onchange: set('to') });

    me.body = h('div');
    const root = h('div', {},
      pageHead({ title: 'Costs', subtitle: 'Fuel and maintenance spend, with the distance your fleet drove.' }),
      h('div', { class: 'flex items-center gap-3 mb-4' }, vehicleSel, from, to),
      me.body);

    me.data = await Api.get('/fleet/costs');
    return root;
  },

  /** The chart needs real layout, so everything is painted once the view is in the page. */
  mounted() { if (S) paint(S.data); },

  destroy(renderId) {
    if (renderId !== undefined && S?.id !== renderId) return; // a stale render finishing late must not touch the current one
    dispose();
  },
};

function dispose() {
  S?.chart?.destroy();
  S = null;
}

async function load() {
  const me = S;
  try {
    const data = await Api.get(`/fleet/costs?${query(S.filters)}`);
    if (S === me) paint(data);
  } catch (err) { Toast.error(err.message); }
}

function paint(d) {
  S.chart?.destroy(); S.chart = null;
  const t = d.totals;
  const canvas = h('canvas', { 'aria-label': 'Fuel and maintenance cost by month' });

  const table = dataTable({
    pageSize: 10, empty: 'No vehicles yet.',
    columns: [
      { key: 'vehicleNumber', label: 'Vehicle', sortable: true, render: (r) => link(r.vehicleNumber, () => navigate(`/fleet/vehicles/${r.vehicleId}`)) },
      { key: 'fuelCost', label: 'Fuel', sortable: true, align: 'num', render: (r) => fmtMoney(r.fuelCost) },
      { key: 'maintenanceCost', label: 'Maintenance', sortable: true, align: 'num', render: (r) => fmtMoney(r.maintenanceCost) },
      { key: 'total', label: 'Total', sortable: true, align: 'num', render: (r) => h('strong', {}, fmtMoney(r.total)) },
      { key: 'distanceKm', label: 'Distance', sortable: true, align: 'num', render: (r) => `${fmtNumber(r.distanceKm, 1)} km` },
      { key: 'costPerKm', label: 'Cost per km', sortable: true, align: 'num', value: (r) => r.costPerKm ?? -1, render: (r) => (r.costPerKm === null ? '—' : fmtMoney(r.costPerKm)) },
    ],
    rows: d.byVehicle.map((v) => ({ ...v, id: v.vehicleId })),
  });

  S.body.replaceChildren(
    h('div', { class: 'grid-4 mb-4' },
      kpiCard({ label: 'Total cost', value: t.total, iconName: 'card', tone: 'accent', format: (n) => fmtMoney(Math.round(n)), foot: 'Fuel + maintenance' }),
      kpiCard({ label: 'Fuel', value: t.fuel, iconName: 'fuel', tone: 'amber', format: (n) => fmtMoney(Math.round(n)), foot: 'From fuel logs' }),
      kpiCard({ label: 'Maintenance', value: t.maintenance, iconName: 'wrench', tone: 'purple', format: (n) => fmtMoney(Math.round(n)), foot: 'Cancelled records excluded' }),
      kpiCard({ label: 'Distance driven', value: d.distanceKm, iconName: 'navigation', tone: 'green', format: (n) => `${fmtNumber(n, 1)} km`, foot: d.costPerKm === null ? 'No completed trips in range' : `${fmtMoney(d.costPerKm)} per km`, })),
    h('div', { class: 'card mb-4' }, h('div', { class: 'card-head' }, h('h3', {}, 'Cost by month')),
      d.byMonth.length ? h('div', { class: 'chart-box' }, canvas) : emptyState('No costs in this range', 'Log fuel or maintenance to see spend here.')),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'By vehicle')), table));

  if (d.byMonth.length) {
    S.chart = barChart(canvas, {
      labels: d.byMonth.map((m) => monthLabel(m.month)),
      datasets: [
        { label: 'Fuel (৳)', data: d.byMonth.map((m) => m.fuel), color: 'amber' },
        { label: 'Maintenance (৳)', data: d.byMonth.map((m) => m.maintenance), color: 'purple' },
      ],
    });
  }
}
