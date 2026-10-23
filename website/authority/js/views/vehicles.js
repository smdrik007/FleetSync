/**
 * Vehicles — `vehicles` with its ER neighbours: model, driver, route, devices, trips, maintenance, fuel.
 * Also exports the drawer / form helpers reused by the live map, trips, devices and dashboard.
 */
import { makeListView } from './_list.js';
import { Lists, invalidate, VEHICLE_STATUSES } from '../data.js';
import {
  h, badge, kv, miniList, miniRow, link, button, iconButton, fmtRelative, fmtDate, fmtDateTime, fmtMoney, fmtNumber,
  modalForm, confirmDialog, titleCase, openDrawer, mutate,
} from '../ui.js';
import { navigate } from '../router.js';

const statusChips = VEHICLE_STATUSES.map((s) => ({ key: s, label: titleCase(s) }));

/* ───────────── create / edit ───────────── */

export async function openVehicleForm(vehicle, onDone) {
  const [models, drivers, routes] = await Promise.all([Lists.models(), Lists.drivers(), Lists.routes()]);
  const editing = !!vehicle;
  const fields = [
    { name: 'vehicleNumber', label: 'Vehicle number', required: true, placeholder: 'Bus #03' },
    { name: 'plateNumber', label: 'Plate number', required: true, placeholder: 'KH-DHA-11-1003' },
    { name: 'modelId', label: 'Model', type: 'select', required: true,
      options: models.map((m) => ({ value: m.id, label: `${m.make} ${m.model}${m.capacity ? ` · ${m.capacity} seats` : ''}${m.isGlobal ? ' (catalog)' : ''}` })) },
    { name: 'currentStatus', label: 'Status', type: 'select', required: true, options: VEHICLE_STATUSES.map((s) => ({ value: s, label: titleCase(s) })) },
    { name: 'fuelEfficiencyKmpl', label: 'Fuel efficiency (km per litre)', type: 'number', step: '0.1', min: '0', placeholder: '4.5', hint: 'Optional. Used to estimate the fuel each trip burns.' },
    { name: 'assignedDriverId', label: 'Driver', type: 'select', emptyLabel: 'None (unassigned)', hint: 'Optional. A driver drives one vehicle — picking someone already assigned moves them here.',
      options: drivers.filter((d) => d.employmentStatus === 'active' || d.id === vehicle?.assignedDriver?.id).map((d) => ({ value: d.id, label: `${d.name}${d.currentVehicleNumber && d.currentVehicleId !== vehicle?.id ? ` — now on ${d.currentVehicleNumber}` : ''}` })) },
    { name: 'assignedRouteId', label: 'Route', type: 'select', emptyLabel: 'None (on-demand)', hint: 'Optional. Leave empty for ride-hailing / on-demand vehicles.',
      options: routes.map((r) => ({ value: r.id, label: r.name })) },
  ];
  modalForm({
    title: editing ? `Edit ${vehicle.vehicleNumber}` : 'Add vehicle', submitLabel: editing ? 'Save changes' : 'Add vehicle', fields,
    errorFields: { PLATE_DUPLICATE: 'plateNumber', INVALID_MODEL: 'modelId', INVALID_ROUTE: 'assignedRouteId', DRIVER_NOT_FOUND: 'assignedDriverId' },
    initial: editing
      ? { vehicleNumber: vehicle.vehicleNumber, plateNumber: vehicle.plateNumber, modelId: vehicle.modelId, currentStatus: vehicle.currentStatus, fuelEfficiencyKmpl: vehicle.fuelEfficiencyKmpl ?? '', assignedDriverId: vehicle.assignedDriver?.id ?? '', assignedRouteId: vehicle.assignedRouteId ?? '' }
      : { currentStatus: 'idle' },
    async onSubmit(values) {
      if (editing) await Api.put(`/fleet/vehicles/${vehicle.id}`, values);
      else await Api.post('/fleet/vehicles', values);
      invalidate();
      Toast.success(editing ? 'Vehicle updated.' : 'Vehicle added.');
      onDone?.();
    },
  });
}

export async function removeVehicle(vehicle, onDone) {
  if (!(await confirmDialog(`Delete ${vehicle.vehicleNumber} (${vehicle.plateNumber})? This cannot be undone.`))) return;
  try {
    await Api.delete(`/fleet/vehicles/${vehicle.id}`);
    invalidate();
    Toast.success('Vehicle deleted.');
    onDone?.();
  } catch (err) {
    Toast.error(err.code === 'HAS_DEPENDENTS' ? `${vehicle.vehicleNumber} has devices, trips or logs on record. Set its status to Retired instead.` : err.message);
  }
}

/* ───────────── detail drawer ───────────── */

/** Opens the vehicle drawer with every related ER section. Returns the drawer handle. */
export async function openVehicleDrawer(id, { onClose, onChanged } = {}) {
  const [v, models, trips, devices, maintenance, fuel] = await Promise.all([
    Api.get(`/fleet/vehicles/${id}`), Lists.models(), Api.get(`/fleet/trips?vehicleId=${id}`), Lists.devices(),
    Api.get(`/fleet/maintenance?vehicleId=${id}`), Api.get(`/fleet/fuel?vehicleId=${id}`),
  ]);
  const model = models.find((m) => m.id === v.modelId);
  const myDevices = devices.filter((d) => d.vehicle?.id === id);
  const pos = v.lastKnownPosition;
  // After an edit: refresh the list behind the drawer and redraw the drawer with fresh data.
  const refresh = () => { onChanged?.(); openVehicleDrawer(id, { onClose, onChanged }); };

  return openDrawer({
    title: v.vehicleNumber, subtitle: v.plateNumber, badge: badge(v.currentStatus), onClose,
    actions: [
      button('Edit', { iconName: 'edit', onClick: () => openVehicleForm(v, refresh) }),
      button('Delete', { variant: 'danger', iconName: 'trash', onClick: () => removeVehicle(v, () => { onChanged?.(); onClose?.(); }) }),
    ],
    sections: [
      { heading: 'Model', content: kv([
        ['Make & model', model ? `${model.make} ${model.model}` : v.model], ['Capacity', v.capacity ? `${v.capacity} seats` : null],
        ['Year', model?.year], ['Fuel type', model?.fuelType ? titleCase(model.fuelType) : null],
        ['Fuel efficiency', v.fuelEfficiencyKmpl ? `${fmtNumber(v.fuelEfficiencyKmpl, 1)} km/L` : null]]) },
      { heading: 'Assignment', content: kv([
        ['Driver', v.assignedDriver ? link(v.assignedDriver.name, () => navigate(`/fleet/drivers/${v.assignedDriver.id}`)) : h('span', { class: 'text-muted' }, 'Unassigned')],
        ['Driver phone', v.assignedDriver?.phone],
        ['Route', v.assignedRouteId ? link(v.assignedRoute, () => navigate(`/fleet/routes/${v.assignedRouteId}`)) : h('span', { class: 'text-muted' }, 'None (on-demand)')]]) },
      { heading: 'Live position', content: pos
        ? h('div', {}, kv([['Last update', `${fmtRelative(pos.updatedAt)}${pos.isStale ? ' (stale)' : ''}`], ['Speed', pos.speed != null ? `${fmtNumber(pos.speed, 0)} km/h` : null], ['Coordinates', pos.latitude != null ? `${pos.latitude.toFixed(4)}, ${pos.longitude.toFixed(4)}` : null]]),
          h('div', { class: 'mt-3' }, button('Show on live map', { iconName: 'map', onClick: () => navigate(`/tracking/map?focus=${id}`) })))
        : h('p', { class: 'section-empty' }, 'No position reported yet.') },
      { heading: `Devices (${myDevices.length})`, content: miniList(myDevices.map((d) => miniRow(
        h('div', {}, h('div', { class: 'cell-main' }, d.deviceType), h('div', { class: 'cell-sub' }, `IMEI ${d.imei} · seen ${fmtRelative(d.lastSeenAt)}`)), badge(d.status), () => navigate('/tracking/devices'))), { empty: 'No tracking device installed.' }) },
      { heading: `Recent trips (${trips.length})`, content: miniList(trips.slice(0, 5).map((t) => miniRow(
        h('div', {}, h('div', { class: 'cell-main' }, fmtDateTime(t.startedAt)), h('div', { class: 'cell-sub' }, `${t.driver.name}${t.route ? ` · ${t.route.name}` : ''}`)), badge(t.status), () => navigate(`/tracking/trips/${t.id}`))), { empty: 'No trips yet.' }) },
      { heading: `Maintenance (${maintenance.length})`, content: miniList(maintenance.slice(0, 5).map((m) => miniRow(
        h('div', {}, h('div', { class: 'cell-main' }, m.description), h('div', { class: 'cell-sub' }, `${fmtDate(m.serviceDate)} · ${fmtMoney(m.cost)}`)), badge(m.status), () => navigate('/operations/maintenance'))), { empty: 'No maintenance records.' }) },
      { heading: `Fuel (${fuel.length})`, content: miniList([
        ...fuel.slice(0, 4).map((f) => miniRow(h('div', {}, h('div', { class: 'cell-main' }, `${fmtNumber(f.volume, 1)} L`), h('div', { class: 'cell-sub' }, `${fmtDate(f.logDate)} · ${f.loggedBy.name}`)), h('strong', {}, fmtMoney(f.totalCost)))),
        ...(fuel.length ? [h('p', { class: 'text-muted' }, `Total: ${fmtMoney(fuel.reduce((a, f) => a + f.totalCost, 0))}`)] : []),
      ], { empty: 'No fuel logs.' }) },
    ],
  });
}

/* ───────────── list screen ───────────── */

let reloadTimer;

export default makeListView({
  title: 'Vehicles', subtitle: 'Every vehicle, with its model, driver and route assignment.', basePath: '/fleet/vehicles',
  searchPlaceholder: 'Search number, plate, driver, route…',
  chips: statusChips, chipOf: (v) => v.currentStatus,
  searchOf: (v) => [v.vehicleNumber, v.plateNumber, v.model, v.assignedDriver?.name, v.assignedRoute],
  load: () => Api.get('/fleet/vehicles'),
  create: { label: 'Add vehicle', run: (api) => openVehicleForm(null, () => api.reload()) },
  emptyText: 'No vehicles match. Add one to get started.',
  columns: (api) => [
    { key: 'vehicleNumber', label: 'Vehicle', sortable: true, render: (v) => h('div', {}, h('div', { class: 'cell-main' }, v.vehicleNumber), h('div', { class: 'cell-sub' }, v.plateNumber)) },
    { key: 'model', label: 'Model', sortable: true, render: (v) => h('div', {}, h('div', {}, v.model || '—'), h('div', { class: 'cell-sub' }, v.capacity ? `${v.capacity} seats` : '')) },
    { key: 'currentStatus', label: 'Status', sortable: true, render: (v) => badge(v.currentStatus) },
    { key: 'driver', label: 'Driver', sortable: true, value: (v) => v.assignedDriver?.name || '', render: (v) => v.assignedDriver?.name || h('span', { class: 'text-muted' }, 'Unassigned') },
    { key: 'assignedRoute', label: 'Route', sortable: true, render: (v) => (v.assignedRoute ? h('span', { class: 'truncate', style: { display: 'inline-block', maxWidth: '240px' }, title: v.assignedRoute }, v.assignedRoute) : h('span', { class: 'text-muted' }, 'On-demand')) },
    { key: 'seen', label: 'Last seen', value: (v) => v.lastKnownPosition?.updatedAt || '', sortable: true,
      render: (v) => (v.lastKnownPosition ? h('span', { style: { color: v.lastKnownPosition.isStale ? 'var(--amber)' : 'var(--green)' } }, fmtRelative(v.lastKnownPosition.updatedAt)) : h('span', { class: 'text-muted' }, 'Never')) },
    { key: 'actions', label: '', render: (v) => h('div', { class: 'row-actions' },
      iconButton('edit', `Edit ${v.vehicleNumber}`, () => openVehicleForm(v, () => api.reload())),
      iconButton('trash', `Delete ${v.vehicleNumber}`, () => removeVehicle(v, () => api.reload()))) },
  ],
  async openDetail({ id, api }) {
    await openVehicleDrawer(id, { onClose: api.closeDetail, onChanged: () => { api.reload({ quiet: true }); } });
  },
  live: (api) => {
    const onEvent = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => api.reload({ quiet: true }), 800); };
    const events = ['vehicle.status_changed', 'vehicle.driver_assigned', 'vehicle.route_updated'];
    events.forEach((e) => WsManager.on(e, onEvent));
    return () => { clearTimeout(reloadTimer); events.forEach((e) => WsManager.off(e, onEvent)); };
  },
});
