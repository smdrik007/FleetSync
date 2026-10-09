/** Maintenance — `maintenance_records` (cost optional until the work is known). */
import { makeListView } from './_list.js';
import { Lists, invalidate } from '../data.js';
import { h, badge, link, iconButton, modalForm, confirmDialog, fmtDate, fmtMoney, titleCase } from '../ui.js';
import { navigate } from '../router.js';

const STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];

async function openMaintenanceForm(rec, onDone) {
  const vehicles = await Lists.vehicles();
  const editing = !!rec;
  modalForm({
    title: editing ? 'Edit maintenance record' : 'Schedule maintenance', submitLabel: editing ? 'Save changes' : 'Schedule',
    fields: [
      { name: 'vehicleId', label: 'Vehicle', type: 'select', required: true, full: true, options: vehicles.map((v) => ({ value: v.id, label: `${v.vehicleNumber} · ${v.plateNumber}` })) },
      { name: 'description', label: 'Work to be done', required: true, full: true, placeholder: 'Brake pad replacement' },
      { name: 'serviceDate', label: 'Service date', type: 'date', required: true },
      { name: 'status', label: 'Status', type: 'select', required: true, options: STATUSES.map((s) => ({ value: s, label: titleCase(s) })) },
      { name: 'cost', label: 'Cost (৳)', type: 'number', min: 0, step: '0.01', hint: 'Optional — leave empty until the cost is known.' },
    ],
    errorFields: { INVALID_VEHICLE: 'vehicleId', INVALID_COST: 'cost', INVALID_SERVICEDATE: 'serviceDate' },
    initial: editing ? { ...rec, vehicleId: rec.vehicle.id, serviceDate: rec.serviceDate?.slice(0, 10) } : { status: 'scheduled' },
    async onSubmit(values) {
      if (editing) await Api.put(`/fleet/maintenance/${rec.id}`, values); else await Api.post('/fleet/maintenance', values);
      invalidate(); Toast.success(editing ? 'Record updated.' : 'Maintenance scheduled.'); onDone();
    },
  });
}

async function removeRecord(rec, onDone) {
  if (!(await confirmDialog(`Delete the "${rec.description}" record for ${rec.vehicle.vehicleNumber}?`))) return;
  try { await Api.delete(`/fleet/maintenance/${rec.id}`); invalidate(); Toast.success('Record deleted.'); onDone(); }
  catch (err) { Toast.error(err.message); }
}

export default makeListView({
  title: 'Maintenance', subtitle: 'Scheduled and completed service work across the fleet.', basePath: '/operations/maintenance',
  searchPlaceholder: 'Search vehicle or work…',
  chips: STATUSES.map((s) => ({ key: s, label: titleCase(s) })), chipOf: (m) => m.status,
  searchOf: (m) => [m.vehicle.vehicleNumber, m.description],
  load: () => Api.get('/fleet/maintenance'),
  create: { label: 'Schedule maintenance', run: (api) => openMaintenanceForm(null, () => api.reload()) },
  summary: (rows) => {
    const counted = rows.filter((r) => r.cost !== null && r.status !== 'cancelled');
    return h('p', { class: 'text-muted mt-3' }, `${rows.length} record${rows.length === 1 ? '' : 's'} shown · total cost ${fmtMoney(counted.reduce((a, r) => a + r.cost, 0))}${counted.length < rows.length ? ' (excludes records without a cost)' : ''}`);
  },
  columns: (api) => [
    { key: 'serviceDate', label: 'Service date', sortable: true, render: (m) => h('span', { class: 'cell-main' }, fmtDate(m.serviceDate)) },
    { key: 'vehicle', label: 'Vehicle', sortable: true, value: (m) => m.vehicle.vehicleNumber, render: (m) => link(m.vehicle.vehicleNumber, () => navigate(`/fleet/vehicles/${m.vehicle.id}`)) },
    { key: 'description', label: 'Work', sortable: true },
    { key: 'cost', label: 'Cost', sortable: true, align: 'num', render: (m) => (m.cost === null ? h('span', { class: 'text-muted' }, 'TBD') : fmtMoney(m.cost)) },
    { key: 'status', label: 'Status', sortable: true, render: (m) => badge(m.status) },
    { key: 'actions', label: '', render: (m) => h('div', { class: 'row-actions' },
      iconButton('edit', `Edit ${m.description}`, () => openMaintenanceForm(m, () => api.reload())),
      iconButton('trash', `Delete ${m.description}`, () => removeRecord(m, () => api.reload()))) },
  ],
});
