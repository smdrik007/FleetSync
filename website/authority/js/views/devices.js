/** Devices — `devices` (trackers of any kind reporting to the platform); online = seen within three report intervals. */
import { makeListView } from './_list.js';
import { Lists, invalidate, DEVICE_STATUSES, Tenant } from '../data.js';
import { h, badge, link, iconButton, modalForm, modalShell, confirmDialog, fmtRelative, titleCase } from '../ui.js';
import { navigate } from '../router.js';

/** One-time key and setup text. The key is hashed on the server, so closing this loses it for good. */
function showSetup(device, heading) {
  const copy = (text, btn) => navigator.clipboard?.writeText(text).then(() => { btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = 'Copy'), 1500); });
  const block = (label, text) => {
    const btn = h('button', { class: 'btn btn-outline btn-sm', type: 'button' }, 'Copy');
    btn.onclick = () => copy(text, btn);
    return h('div', { class: 'form-group full' }, h('div', { class: 'form-label' }, label),
      h('pre', { style: 'white-space:pre-wrap;word-break:break-all;margin:0 0 .5rem;padding:.75rem;border:1px solid var(--border);border-radius:8px;font-size:.8rem' }, text), btn);
  };
  const ctl = modalShell({
    title: heading, size: '',
    body: h('div', { class: 'modal-body' },
      device.apiKey ? h('div', { class: 'alert alert-danger' }, 'Copy the key now. It is shown only once; use "Rotate key" later to get a new one.') : null,
      device.apiKey ? block('Device key', device.apiKey) : null,
      device.setup ? block('Setup', device.setup) : null),
    foot: h('div', { class: 'modal-foot' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctl.close() }, 'Done')),
  });
}

async function openDeviceForm(device, onDone) {
  // A vehicle institution attaches devices to vehicles, a people/things institution to people: only the matching list is asked for.
  const fleet = Tenant.isFleet();
  const [vehicles, types, people] = await Promise.all([fleet ? Lists.vehicles() : [], Api.get('/fleet/device-types'), fleet ? [] : Api.get('/fleet/people')]);
  const editing = !!device;
  const options = types.map((t) => ({ value: t.code, label: t.name }));
  // Devices made before the catalog keep their free-text type.
  if (editing && !options.some((o) => o.value === device.deviceType)) options.unshift({ value: device.deviceType, label: device.deviceType });
  const byCode = Object.fromEntries(types.map((t) => [t.code, t]));
  const form = modalForm({
    title: editing ? 'Edit device' : 'Register device', submitLabel: editing ? 'Save changes' : 'Register',
    fields: [
      fleet
        ? { name: 'vehicleId', label: 'Installed in', type: 'select', required: true, options: vehicles.map((v) => ({ value: v.id, label: `${v.vehicleNumber} · ${v.plateNumber}` })) }
        : { name: 'assetId', label: 'Worn or carried by', type: 'select', required: true, options: people.map((p) => ({ value: p.id, label: p.code ? `${p.name} · ${p.code}` : p.name })), hint: people.length ? undefined : 'Add a person on the People screen first.' },
      { name: 'deviceType', label: 'Device type', type: 'select', required: true, options, hint: 'Decides how the device reports and what setup steps you get.' },
      { name: 'imei', label: 'Device ID (IMEI)', required: true, hint: 'Unique across the platform. For a microcontroller, any unique text such as its MAC address.' },
      { name: 'reportingIntervalS', label: 'Reports every (seconds)', type: 'number', min: 1, hint: 'Leave empty to use the type\'s default. A device is offline after three missed reports.' },
      { name: 'simIccid', label: 'SIM ICCID' },
      { name: 'firmwareVersion', label: 'Firmware version', placeholder: '2.4.0' },
      { name: 'status', label: 'Status', type: 'select', required: true, options: DEVICE_STATUSES.map((s) => ({ value: s, label: titleCase(s) })) },
    ],
    errorFields: { DUPLICATE_IMEI: 'imei', INVALID_VEHICLE: 'vehicleId', INVALID_ASSET: 'assetId', INVALID_REPORTINGINTERVALS: 'reportingIntervalS' },
    initial: editing ? { ...device, vehicleId: device.vehicle?.id ?? '', assetId: device.asset?.id ?? '' } : { deviceType: byCode['esp32-json'] ? 'esp32-json' : options[0]?.value, status: 'active' },
    async onSubmit(values) {
      if (editing) {
        await Api.put(`/fleet/devices/${device.id}`, values);
        invalidate(); Toast.success('Device updated.'); onDone();
      } else {
        const created = await Api.post('/fleet/devices', values);
        invalidate(); onDone();
        if (created.apiKey || created.setup) showSetup(created, `Set up ${byCode[created.deviceType]?.name || created.deviceType}`);
        else Toast.success('Device registered.');
      }
    },
  });
  return form;
}

async function openSetup(device) {
  try {
    const { setup } = await Api.get(`/fleet/devices/${device.id}/setup`);
    if (!setup) return Toast.info?.('This device uses a free-text type with no setup guide. Edit it and choose a type.') ?? Toast.error('No setup guide for this device type.');
    showSetup({ setup }, `Setup · ${device.imei}`);
  } catch (err) { Toast.error(err.message); }
}

async function rotateKey(device, onDone) {
  if (!(await confirmDialog(`Issue a new key for ${device.imei}? The old key stops working immediately.`, { confirmLabel: 'Rotate key', danger: false, title: 'Rotate key' }))) return;
  try { const r = await Api.post(`/fleet/devices/${device.id}/rotate-key`); onDone(); showSetup(r, 'New device key'); }
  catch (err) { Toast.error(err.message); }
}

async function removeDevice(device, onDone) {
  if (!(await confirmDialog(`Remove device ${device.imei}?`, { confirmLabel: 'Remove' }))) return;
  try { await Api.delete(`/fleet/devices/${device.id}`); invalidate(); Toast.success('Device removed.'); onDone(); }
  catch (err) { Toast.error(err.code === 'HAS_DEPENDENTS' ? 'This device has GPS history on record. Set its status to Retired instead.' : err.message); }
}

export default makeListView({
  title: 'Devices', subtitle: Tenant.isFleet() ? 'Tracking hardware installed in vehicles and its last check-in.' : 'Trackers worn or carried by people and things, and their last check-in.', basePath: '/tracking/devices',
  searchPlaceholder: 'Search device ID, vehicle, firmware…',
  chips: DEVICE_STATUSES.map((s) => ({ key: s, label: titleCase(s) })), chipOf: (d) => d.status,
  searchOf: (d) => [d.imei, d.vehicle?.vehicleNumber, d.asset?.name, d.deviceType, d.firmwareVersion, d.simIccid],
  load: () => Api.get('/fleet/devices'),
  create: { label: 'Register device', run: (api) => openDeviceForm(null, () => api.reload()) },
  columns: (api) => [
    { key: 'imei', label: 'Device', sortable: true, render: (d) => h('div', {}, h('div', { class: 'cell-main' }, d.deviceType), h('div', { class: 'cell-sub' }, `ID ${d.imei}`)) },
    { key: 'vehicle', label: Tenant.isFleet() ? 'Vehicle' : 'Worn by', sortable: true, value: (d) => d.vehicle?.vehicleNumber || d.asset?.name || '',
      render: (d) => (d.vehicle ? link(d.vehicle.vehicleNumber, () => navigate(`/fleet/vehicles/${d.vehicle.id}`)) : link(d.asset.name, () => navigate(`/tracking/people/${d.asset.id}`))) },
    { key: 'status', label: 'Status', sortable: true, render: (d) => badge(d.status) },
    { key: 'lastSeenAt', label: 'Last seen', sortable: true, render: (d) => h('span', { class: 'flex items-center gap-2' }, h('i', { class: `dot-live ${d.isOnline ? '' : 'off'}` }), d.lastSeenAt ? fmtRelative(d.lastSeenAt) : 'Never') },
    { key: 'batteryPct', label: 'Battery', sortable: true, render: (d) => (d.batteryPct == null ? '—' : `${Math.round(d.batteryPct)}%`) },
    { key: 'reportingIntervalS', label: 'Interval', render: (d) => (d.reportingIntervalS ? `${d.reportingIntervalS}s` : '—') },
    { key: 'firmwareVersion', label: 'Firmware', render: (d) => d.firmwareVersion || '—' },
    { key: 'actions', label: '', render: (d) => h('div', { class: 'row-actions' },
      iconButton('info', `Setup guide for ${d.imei}`, () => openSetup(d)),
      ...(d.hasKey ? [iconButton('refresh', `Rotate key for ${d.imei}`, () => rotateKey(d, () => api.reload()))] : []),
      iconButton('edit', `Edit device ${d.imei}`, () => openDeviceForm(d, () => api.reload())),
      iconButton('trash', `Remove device ${d.imei}`, () => removeDevice(d, () => api.reload()))) },
  ],
});
