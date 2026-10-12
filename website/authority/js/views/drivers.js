/** Drivers — `drivers` (employee record, license, employment status) linked to their login `users` row. */
import { makeListView } from './_list.js';
import { invalidate, EMPLOYMENT_STATUSES } from '../data.js';
import {
  h, badge, kv, miniList, miniRow, link, button, iconButton, modalForm, confirmDialog, fmtDate, fmtDateTime, titleCase, daysUntil, initials,
} from '../ui.js';
import { navigate } from '../router.js';

/** License expiry as a coloured badge: red when expired, amber within 30 days. */
function expiryBadge(iso) {
  if (!iso) return h('span', { class: 'text-muted' }, '—');
  const d = daysUntil(iso);
  const tone = d < 0 ? 'red' : d <= 30 ? 'amber' : 'green';
  const text = d < 0 ? `Expired ${-d}d ago` : d === 0 ? 'Expires today' : d <= 30 ? `${d} days left` : fmtDate(iso);
  return h('span', { class: `badge badge-${tone}`, title: fmtDate(iso) }, text);
}

function openDriverForm(driver, onDone) {
  const editing = !!driver;
  const common = [
    { name: 'licenseNumber', label: 'License number', required: true },
    { name: 'licenseClass', label: 'License class', placeholder: 'Heavy' },
    { name: 'licenseExpiry', label: 'License expiry', type: 'date' },
    { name: 'employeeCode', label: 'Employee code' },
    { name: 'hiredAt', label: 'Hired on', type: 'date' },
  ];
  const fields = editing
    ? [{ name: 'name', label: 'Full name', required: true }, { name: 'phone', label: 'Phone' }, ...common,
       { name: 'employmentStatus', label: 'Employment status', type: 'select', required: true, options: EMPLOYMENT_STATUSES.map((s) => ({ value: s, label: titleCase(s) })) }]
    : [{ name: 'name', label: 'Full name', required: true }, { name: 'phone', label: 'Phone', required: true, placeholder: '+8801…' },
       { name: 'email', label: 'Login email', type: 'email', required: true }, { name: 'password', label: 'Temporary password', type: 'password', required: true, hint: 'At least 8 characters. The driver signs in with their email and this password.' }, ...common];
  modalForm({
    title: editing ? `Edit ${driver.name}` : 'Add driver', submitLabel: editing ? 'Save changes' : 'Add driver', fields,
    errorFields: { EMAIL_EXISTS: 'email', PHONE_EXISTS: 'phone', DUPLICATE_LICENSE: 'licenseNumber', WEAK_PASSWORD: 'password', INVALID_EMPLOYMENTSTATUS: 'employmentStatus' },
    initial: editing ? { ...driver, licenseExpiry: driver.licenseExpiry?.slice(0, 10), hiredAt: driver.hiredAt?.slice(0, 10) } : {},
    async onSubmit(values) {
      if (editing) await Api.put(`/fleet/drivers/${driver.id}`, values); else await Api.post('/fleet/drivers', values);
      invalidate(); Toast.success(editing ? 'Driver updated.' : 'Driver added.'); onDone();
    },
  });
}

async function removeDriver(driver, onDone) {
  if (!(await confirmDialog(`Delete ${driver.name}? Their login account is kept.`))) return;
  try { await Api.delete(`/fleet/drivers/${driver.id}`); invalidate(); Toast.success('Driver deleted.'); onDone(); }
  catch (err) { Toast.error(err.message); }
}

export default makeListView({
  title: 'Drivers', subtitle: 'Employee records, license status and current vehicle.', basePath: '/fleet/drivers',
  searchPlaceholder: 'Search name, email, license…',
  chips: EMPLOYMENT_STATUSES.map((s) => ({ key: s, label: titleCase(s) })), chipOf: (d) => d.employmentStatus,
  searchOf: (d) => [d.name, d.email, d.phone, d.licenseNumber, d.employeeCode, d.currentVehicleNumber],
  load: () => Api.get('/fleet/drivers'),
  create: { label: 'Add driver', run: (api) => openDriverForm(null, () => api.reload()) },
  columns: (api) => [
    { key: 'name', label: 'Driver', sortable: true, render: (d) => h('div', { class: 'flex items-center gap-3' }, h('span', { class: 'avatar' }, initials(d.name)),
      h('div', {}, h('div', { class: 'cell-main' }, d.name), h('div', { class: 'cell-sub' }, d.email || 'No login'))) },
    { key: 'phone', label: 'Phone', render: (d) => d.phone || '—' },
    { key: 'licenseNumber', label: 'License', sortable: true, render: (d) => h('div', {}, h('div', {}, d.licenseNumber), h('div', { class: 'cell-sub' }, d.licenseClass || '')) },
    { key: 'licenseExpiry', label: 'Expiry', sortable: true, render: (d) => expiryBadge(d.licenseExpiry) },
    { key: 'employmentStatus', label: 'Status', sortable: true, render: (d) => badge(d.employmentStatus) },
    { key: 'currentVehicleNumber', label: 'Vehicle', sortable: true, render: (d) => (d.currentVehicleId ? link(d.currentVehicleNumber, () => navigate(`/fleet/vehicles/${d.currentVehicleId}`)) : h('span', { class: 'text-muted' }, 'None')) },
    { key: 'actions', label: '', render: (d) => h('div', { class: 'row-actions' },
      iconButton('edit', `Edit ${d.name}`, () => openDriverForm(d, () => api.reload())),
      iconButton('trash', `Delete ${d.name}`, () => removeDriver(d, () => api.reload()))) },
  ],
  async openDetail({ id, api }) {
    const [d, trips] = await Promise.all([Api.get('/fleet/drivers').then((all) => all.find((x) => x.id === id)), Api.get(`/fleet/trips?driverId=${id}`)]);
    if (!d) throw new Error('Driver not found.');
    api.drawer({
      title: d.name, subtitle: d.employeeCode ? `Employee ${d.employeeCode}` : 'Driver', badge: badge(d.employmentStatus),
      actions: [button('Edit', { iconName: 'edit', onClick: () => openDriverForm(d, () => { api.reload({ quiet: true }); api.openDetail(id); }) }),
        button('Delete', { variant: 'danger', iconName: 'trash', onClick: () => removeDriver(d, () => { api.reload(); api.closeDetail(); }) })],
      sections: [
        { heading: 'Profile', content: kv([['Phone', d.phone], ['Login email', d.email], ['Hired on', fmtDate(d.hiredAt)], ['Employee code', d.employeeCode]]) },
        { heading: 'License', content: kv([['Number', d.licenseNumber], ['Class', d.licenseClass], ['Expiry', expiryBadge(d.licenseExpiry)]]) },
        { heading: 'Assigned vehicle', content: d.currentVehicleId
          ? miniList([miniRow(h('div', { class: 'cell-main' }, d.currentVehicleNumber), null, () => navigate(`/fleet/vehicles/${d.currentVehicleId}`))])
          : h('p', { class: 'section-empty' }, 'Not assigned to a vehicle.') },
        { heading: `Recent trips (${trips.length})`, content: miniList(trips.slice(0, 6).map((t) => miniRow(
          h('div', {}, h('div', { class: 'cell-main' }, fmtDateTime(t.startedAt)), h('div', { class: 'cell-sub' }, `${t.vehicle.vehicleNumber}${t.route ? ` · ${t.route.name}` : ''}`)), badge(t.status), () => navigate(`/tracking/trips/${t.id}`))), { empty: 'No trips yet.' }) },
      ],
    });
  },
});
