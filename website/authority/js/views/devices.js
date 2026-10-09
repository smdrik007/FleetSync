/** Devices — `devices` (GPS trackers installed in vehicles); online = seen in the last 5 minutes. */
import { makeListView } from './_list.js';
import { Lists, invalidate, DEVICE_STATUSES } from '../data.js';
import { h, badge, link, iconButton, modalForm, confirmDialog, fmtRelative, titleCase } from '../ui.js';
import { navigate } from '../router.js';

async function openDeviceForm(device, onDone) {
  const vehicles = await Lists.vehicles();
  const editing = !!device;
  modalForm({
    title: editing ? 'Edit device' : 'Register device', submitLabel: editing ? 'Save changes' : 'Register',
    fields: [
      { name: 'vehicleId', label: 'Installed in', type: 'select', required: true, options: vehicles.map((v) => ({ value: v.id, label: `${v.vehicleNumber} · ${v.plateNumber}` })) },
      { name: 'deviceType', label: 'Device type', required: true, placeholder: 'GPS Tracker' },
      { name: 'imei', label: 'IMEI', required: true, hint: 'Unique across the platform.' },
      { name: 'simIccid', label: 'SIM ICCID' },
      { name: 'firmwareVersion', label: 'Firmware version', placeholder: '2.4.0' },
      { name: 'status', label: 'Status', type: 'select', required: true, options: DEVICE_STATUSES.map((s) => ({ value: s, label: titleCase(s) })) },
    ],
    errorFields: { DUPLICATE_IMEI: 'imei', INVALID_VEHICLE: 'vehicleId' },
    initial: editing ? { ...device, vehicleId: device.vehicle.id } : { deviceType: 'GPS Tracker', status: 'active' },
    async onSubmit(values) {
      if (editing) await Api.put(`/fleet/devices/${device.id}`, values); else await Api.post('/fleet/devices', values);
      invalidate(); Toast.success(editing ? 'Device updated.' : 'Device registered.'); onDone();
    },
  });
}

async function removeDevice(device, onDone) {
  if (!(await confirmDialog(`Remove device ${device.imei}?`, { confirmLabel: 'Remove' }))) return;
  try { await Api.delete(`/fleet/devices/${device.id}`); invalidate(); Toast.success('Device removed.'); onDone(); }
  catch (err) { Toast.error(err.code === 'HAS_DEPENDENTS' ? 'This device has GPS history on record. Set its status to Retired instead.' : err.message); }
}

export default makeListView({
  title: 'Devices', subtitle: 'Tracking hardware and its last check-in.', basePath: '/tracking/devices',
  searchPlaceholder: 'Search IMEI, vehicle, firmware…',
  chips: DEVICE_STATUSES.map((s) => ({ key: s, label: titleCase(s) })), chipOf: (d) => d.status,
  searchOf: (d) => [d.imei, d.vehicle.vehicleNumber, d.deviceType, d.firmwareVersion, d.simIccid],
  load: () => Api.get('/fleet/devices'),
  create: { label: 'Register device', run: (api) => openDeviceForm(null, () => api.reload()) },
  columns: (api) => [
    { key: 'imei', label: 'Device', sortable: true, render: (d) => h('div', {}, h('div', { class: 'cell-main' }, d.deviceType), h('div', { class: 'cell-sub' }, `IMEI ${d.imei}`)) },
    { key: 'vehicle', label: 'Vehicle', sortable: true, value: (d) => d.vehicle.vehicleNumber, render: (d) => link(d.vehicle.vehicleNumber, () => navigate(`/fleet/vehicles/${d.vehicle.id}`)) },
    { key: 'status', label: 'Status', sortable: true, render: (d) => badge(d.status) },
    { key: 'lastSeenAt', label: 'Last seen', sortable: true, render: (d) => h('span', { class: 'flex items-center gap-2' }, h('i', { class: `dot-live ${d.isOnline ? '' : 'off'}` }), d.lastSeenAt ? fmtRelative(d.lastSeenAt) : 'Never') },
    { key: 'firmwareVersion', label: 'Firmware', render: (d) => d.firmwareVersion || '—' },
    { key: 'simIccid', label: 'SIM', render: (d) => d.simIccid || '—' },
    { key: 'actions', label: '', render: (d) => h('div', { class: 'row-actions' },
      iconButton('edit', `Edit device ${d.imei}`, () => openDeviceForm(d, () => api.reload())),
      iconButton('trash', `Remove device ${d.imei}`, () => removeDevice(d, () => api.reload()))) },
  ],
});
