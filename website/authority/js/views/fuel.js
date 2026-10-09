/** Fuel Logs — `fuel_logs` (who logged it comes from the signed-in user). */
import { makeListView } from './_list.js';
import { Lists, invalidate } from '../data.js';
import { h, link, iconButton, modalForm, confirmDialog, fmtDate, fmtMoney, fmtNumber } from '../ui.js';
import { navigate } from '../router.js';

const today = () => new Date().toISOString().slice(0, 10);

async function openFuelForm(onDone) {
  const vehicles = await Lists.vehicles();
  modalForm({
    title: 'Log fuel', submitLabel: 'Save log',
    fields: [
      { name: 'vehicleId', label: 'Vehicle', type: 'select', required: true, full: true, options: vehicles.map((v) => ({ value: v.id, label: `${v.vehicleNumber} · ${v.plateNumber}` })) },
      { name: 'volume', label: 'Volume (litres)', type: 'number', required: true, min: 0, step: '0.01' },
      { name: 'totalCost', label: 'Total cost (৳)', type: 'number', required: true, min: 0, step: '0.01' },
      { name: 'logDate', label: 'Date', type: 'date', required: true },
    ],
    errorFields: { INVALID_VEHICLE: 'vehicleId', INVALID_VOLUME: 'volume', INVALID_TOTAL_COST: 'totalCost' },
    initial: { logDate: today() },
    async onSubmit(values) {
      await Api.post('/fleet/fuel', values);
      invalidate(); Toast.success('Fuel logged.'); onDone();
    },
  });
}

async function removeLog(log, onDone) {
  if (!(await confirmDialog(`Delete the ${fmtNumber(log.volume, 1)} L fuel log for ${log.vehicle.vehicleNumber}?`))) return;
  try { await Api.delete(`/fleet/fuel/${log.id}`); invalidate(); Toast.success('Fuel log deleted.'); onDone(); }
  catch (err) { Toast.error(err.message); }
}

export default makeListView({
  title: 'Fuel Logs', subtitle: 'Refuelling records with cost and who logged them.', basePath: '/operations/fuel',
  searchPlaceholder: 'Search vehicle or person…', searchOf: (f) => [f.vehicle.vehicleNumber, f.loggedBy.name],
  load: () => Api.get('/fleet/fuel'),
  create: { label: 'Log fuel', run: (api) => openFuelForm(() => api.reload()) },
  filterRow: (f, api) => !api.extra.vehicleId || f.vehicle.id === api.extra.vehicleId,
  toolbar: (api) => {
    const sel = h('select', { class: 'form-select', style: { width: '180px' }, 'aria-label': 'Filter by vehicle' }, h('option', { value: '' }, 'All vehicles'));
    Lists.vehicles().then((vs) => vs.forEach((v) => sel.append(h('option', { value: v.id }, v.vehicleNumber))));
    sel.addEventListener('change', () => { api.extra.vehicleId = sel.value; api.refresh(); });
    return [sel];
  },
  summary: (rows) => {
    const litres = rows.reduce((a, r) => a + r.volume, 0); const cost = rows.reduce((a, r) => a + r.totalCost, 0);
    return h('p', { class: 'text-muted mt-3' }, `${rows.length} log${rows.length === 1 ? '' : 's'} shown · ${fmtNumber(litres, 1)} L · ${fmtMoney(cost)}${litres ? ` · avg ${fmtMoney(cost / litres)}/L` : ''}`);
  },
  columns: (api) => [
    { key: 'logDate', label: 'Date', sortable: true, render: (f) => h('span', { class: 'cell-main' }, fmtDate(f.logDate)) },
    { key: 'vehicle', label: 'Vehicle', sortable: true, value: (f) => f.vehicle.vehicleNumber, render: (f) => link(f.vehicle.vehicleNumber, () => navigate(`/fleet/vehicles/${f.vehicle.id}`)) },
    { key: 'volume', label: 'Volume', sortable: true, align: 'num', render: (f) => `${fmtNumber(f.volume, 1)} L` },
    { key: 'totalCost', label: 'Total cost', sortable: true, align: 'num', render: (f) => fmtMoney(f.totalCost) },
    { key: 'ppl', label: 'Per litre', align: 'num', value: (f) => f.totalCost / f.volume, sortable: true, render: (f) => fmtMoney(f.totalCost / f.volume) },
    { key: 'loggedBy', label: 'Logged by', render: (f) => f.loggedBy.name },
    { key: 'actions', label: '', render: (f) => h('div', { class: 'row-actions' }, iconButton('trash', `Delete fuel log for ${f.vehicle.vehicleNumber}`, () => removeLog(f, () => api.reload()))) },
  ],
});
