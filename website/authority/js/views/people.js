/** People — tracked people and equipment: consent, device, guardians, safe zones, live position. */
import { makeListView } from './_list.js';
import { Lists, invalidate } from '../data.js';
import { h, badge, kv, miniList, miniRow, button, iconButton, fmtRelative, fmtDateTime, modalForm, confirmDialog, titleCase, openDrawer, initials } from '../ui.js';
import { createMap, vehicleMarker, fitTo, tip } from '../maps.js';
import { navigate } from '../router.js';

const KINDS = [{ value: 'person', label: 'Person' }, { value: 'equipment', label: 'Equipment' }];
let drawerLive = null;   // { assetId, update(d) } for the open drawer, fed by WebSocket events

const consentBadge = (p) => (p.trackingPaused ? badge('suspended', 'Paused') : p.consentAt ? badge('active', 'Consent recorded') : badge('faulty', 'Consent needed'));

function openPersonForm(person, onDone) {
  const editing = !!person;
  modalForm({
    title: editing ? 'Edit person' : 'Add person', submitLabel: editing ? 'Save changes' : 'Add',
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'code', label: 'ID number', placeholder: 'e.g. student or resident number', hint: 'Optional. Makes the person easy to find by search. Must be unique.' },
      { name: 'kind', label: 'Type', type: 'select', required: true, options: KINDS },
      { name: 'retentionDays', label: 'Keep location history (days)', type: 'number', min: 1, max: 365, hint: 'Older points are deleted automatically. Default 30.' },
      { name: 'consent', label: 'Consent recorded', type: 'select', required: true, options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No: tracking stays off' }], hint: 'Location is only stored after the person or their guardian has agreed.' },
      { name: 'consentBy', label: 'Consent given by', placeholder: 'e.g. Parent: Rahima Begum' },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
    errorFields: { INVALID_RETENTIONDAYS: 'retentionDays', DUPLICATE_CODE: 'code' },
    initial: editing ? { ...person, consent: person.consentAt ? 'yes' : 'no' } : { kind: 'person', consent: 'no', retentionDays: 30 },
    async onSubmit(v) {
      const body = { name: v.name, code: v.code, kind: v.kind, notes: v.notes, consent: v.consent === 'yes', consentBy: v.consentBy, retentionDays: v.retentionDays ?? undefined };
      if (editing) await Api.put(`/fleet/people/${person.id}`, body); else await Api.post('/fleet/people', body);
      invalidate(); Toast.success(editing ? 'Saved.' : 'Person added.'); onDone();
    },
  });
}

async function openGuardians(person, onDone) {
  const users = (await Lists.users()).filter((u) => u.roles.includes('GUARDIAN'));
  if (!users.length) { Toast.error('No guardians yet. Add one on the Guardians screen first.'); return; }
  modalForm({
    title: `Guardians of ${person.name}`, submitLabel: 'Save',
    fields: [{ name: 'userIds', label: 'Guardians', type: 'checkboxes', options: users.map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` })) }],
    initial: { userIds: person.guardians.map((g) => g.id) },
    async onSubmit(v) { await Api.put(`/fleet/people/${person.id}/guardians`, { userIds: v.userIds }); Toast.success('Guardians updated.'); onDone(); },
  });
}

function openZoneForm(person, onDone) {
  const p = person.position;
  modalForm({
    title: 'Add safe zone', submitLabel: 'Add zone',
    fields: [
      { name: 'name', label: 'Zone name', required: true, placeholder: 'Home, School…' },
      { name: 'radiusM', label: 'Radius (metres)', type: 'number', required: true, min: 20, max: 50000 },
      { name: 'latitude', label: 'Centre latitude', type: 'number', required: true, step: 'any' },
      { name: 'longitude', label: 'Centre longitude', type: 'number', required: true, step: 'any', hint: p ? 'Prefilled with the current position: add the zone while the person is inside it.' : 'No position yet: enter the centre coordinates.' },
    ],
    errorFields: { INVALID_RADIUSM: 'radiusM', INVALID_LATITUDE: 'latitude', INVALID_LONGITUDE: 'longitude' },
    initial: { radiusM: 200, latitude: p?.lat ?? '', longitude: p?.lng ?? '' },
    async onSubmit(v) { await Api.post(`/fleet/people/${person.id}/geofences`, v); Toast.success('Safe zone added.'); onDone(); },
  });
}

async function removePerson(person, onDone) {
  if (!(await confirmDialog(`Remove ${person.name}? Their location history, safe zones and guardian links are deleted.`, { confirmLabel: 'Remove' }))) return;
  try { await Api.delete(`/fleet/people/${person.id}`); invalidate(); Toast.success('Removed.'); onDone(); }
  catch (err) { Toast.error(err.code === 'HAS_DEPENDENTS' ? 'Move or remove this person\'s device on the Devices screen first.' : err.message); }
}

/** The map: current position, safe zones and the last 24 hours as a trail. */
function personMap(person, trail) {
  const el = h('div', { class: 'map-box short' });
  const map = createMap(el, { zoom: 15 });
  const live = { assetId: person.id, marker: null, map };
  const draw = (pos, sos) => {
    if (!pos) return;
    const icon = vehicleMarker([pos.lat, pos.lng], { label: initials(person.name), status: sos ? 'maintenance' : 'on_trip', stale: !!pos.isStale, live: !pos.isStale }).options.icon;
    if (live.marker) { live.marker.setLatLng([pos.lat, pos.lng]); live.marker.setIcon(icon); }
    else live.marker = L.marker([pos.lat, pos.lng], { icon }).bindTooltip(tip(person.name)).addTo(map);
  };
  const pts = [];
  person.geofences.forEach((z) => { L.circle([z.latitude, z.longitude], { radius: z.radiusM, color: '#2e9d6b', weight: 2, fillOpacity: 0.12 }).bindTooltip(tip(z.name)).addTo(map); pts.push([z.latitude, z.longitude]); });
  if (trail.length > 1) L.polyline(trail.map((t) => [t.lat, t.lng]), { color: '#2ee6c5', weight: 3, opacity: 0.6 }).addTo(map);
  draw(person.position, person.position?.sos);
  if (person.position) pts.push([person.position.lat, person.position.lng]);
  fitTo(map, pts, { maxZoom: 16 });
  live.draw = draw;
  return { el, live };
}

export async function openPersonDrawer(id, { onClose, onChanged } = {}) {
  const [people, trail] = await Promise.all([Api.get('/fleet/people'), Api.get(`/fleet/people/${id}/track?hours=24`).catch(() => [])]);
  const person = people.find((p) => p.id === id);
  if (!person) { Toast.error('Person not found.'); onClose?.(); return; }
  const refresh = () => { onChanged?.(); openPersonDrawer(id, { onChanged, onClose }); };
  const map = personMap(person, trail);

  const buildSections = () => {
    const pos = person.position;
    return [
      { heading: 'Location', content: h('div', {}, map.el, kv([
        ['Last update', pos ? `${fmtRelative(pos.recordedAt)}${pos.isStale ? ' (stale)' : ''}` : 'No position yet'],
        ['Battery', pos?.batteryPct != null ? `${Math.round(pos.batteryPct)}%` : null],
        ['SOS', pos?.sos ? h('strong', { style: { color: 'var(--red)' } }, 'Active') : null]])) },
      { heading: 'Consent and privacy', content: kv([
        ['Consent', person.consentAt ? `Recorded ${fmtDateTime(person.consentAt)}` : 'Not recorded: no location is stored'],
        ['Given by', person.consentBy], ['History kept', `${person.retentionDays} days`], ['Notes', person.notes]]) },
      { heading: 'Device', content: person.device
        ? miniList([miniRow(h('div', {}, h('div', { class: 'cell-main' }, person.device.deviceType), h('div', { class: 'cell-sub' }, `ID ${person.device.imei} · seen ${person.device.lastSeenAt ? fmtRelative(person.device.lastSeenAt) : 'never'}`)), badge(person.device.status), () => navigate('/tracking/devices'))])
        : h('p', { class: 'section-empty' }, 'No device yet. Register one on the Devices screen and choose this person.') },
      { heading: `Guardians (${person.guardians.length})`, action: button('Edit', { size: 'sm', onClick: () => openGuardians(person, refresh) }),
        content: miniList(person.guardians.map((g) => miniRow(h('div', {}, h('div', { class: 'cell-main' }, g.relationship ? `${g.name} · ${g.relationship}` : g.name), h('div', { class: 'cell-sub' }, g.email)), null, () => navigate('/tracking/guardians'))), { empty: 'No guardians linked. They get alerts and a page showing where this person is.' }) },
      { heading: `Safe zones (${person.geofences.length})`, action: button('Add zone', { size: 'sm', iconName: 'plus', onClick: () => openZoneForm(person, refresh) }),
        content: miniList(person.geofences.map((z) => miniRow(h('div', {}, h('div', { class: 'cell-main' }, z.name), h('div', { class: 'cell-sub' }, `${z.radiusM} m radius`)),
          iconButton('trash', `Remove zone ${z.name}`, async () => { await Api.delete(`/fleet/people/${id}/geofences/${z.id}`); refresh(); }))), { empty: 'No safe zones. Add one to be alerted when the person leaves it.' }) },
    ];
  };

  const drawer = openDrawer({
    title: person.name, subtitle: person.code ? `${titleCase(person.kind)} · ID ${person.code}` : titleCase(person.kind), badge: consentBadge(person),
    onClose: () => { drawerLive = null; onClose?.(); },
    actions: [
      button('Edit', { iconName: 'edit', onClick: () => openPersonForm(person, refresh) }),
      button(person.trackingPaused ? 'Resume tracking' : 'Pause tracking', { iconName: person.trackingPaused ? 'play' : 'pause',
        onClick: async () => { await Api.put(`/fleet/people/${id}`, { trackingPaused: !person.trackingPaused }); refresh(); } }),
      button('Delete', { variant: 'danger', iconName: 'trash', onClick: () => removePerson(person, () => { onChanged?.(); onClose?.(); }) }),
    ],
    sections: buildSections(),
  });
  // A live fix repaints the marker and the facts under the map; the map itself is kept.
  drawerLive = {
    assetId: id,
    update(d) {
      person.position = { lat: d.latitude, lng: d.longitude, speed: d.speed, batteryPct: d.batteryPct, sos: !!d.sos, recordedAt: d.timestamp, isStale: false };
      map.live.draw(person.position, person.position.sos);
      drawer.setSections(buildSections());
    },
  };
  return drawer;
}

/** Feed a live fix to the open drawer, if it is showing that person (used by the People Map too). */
export function updateOpenPersonDrawer(d) {
  if (drawerLive && drawerLive.assetId === d.assetId) drawerLive.update(d);
}

let reloadTimer;

export default makeListView({
  title: 'People', subtitle: 'People and equipment tracked with a device, with consent, guardians and safe zones.', basePath: '/tracking/people',
  searchPlaceholder: 'Search name, ID number, guardian, device…',
  chips: [{ key: 'active', label: 'Tracking' }, { key: 'paused', label: 'Paused' }, { key: 'needs_consent', label: 'Consent needed' }],
  chipOf: (p) => (p.trackingPaused ? 'paused' : p.consentAt ? 'active' : 'needs_consent'),
  searchOf: (p) => [p.name, p.code, p.id, p.device?.imei, ...p.guardians.map((g) => g.name)],
  load: () => Api.get('/fleet/people'),
  create: { label: 'Add person', run: (api) => openPersonForm(null, () => api.reload()) },
  emptyText: 'No one is being tracked yet. Add a person, then register their device.',
  columns: (api) => [
    { key: 'name', label: 'Name', sortable: true, render: (p) => h('div', {}, h('div', { class: 'cell-main' }, p.name), h('div', { class: 'cell-sub' }, p.code ? `${titleCase(p.kind)} · ID ${p.code}` : titleCase(p.kind))) },
    { key: 'consentAt', label: 'Status', render: (p) => consentBadge(p) },
    { key: 'device', label: 'Device', render: (p) => (p.device ? h('div', {}, h('div', {}, p.device.deviceType), h('div', { class: 'cell-sub' }, p.device.batteryPct != null ? `Battery ${Math.round(p.device.batteryPct)}%` : `ID ${p.device.imei}`)) : h('span', { class: 'text-muted' }, 'None')) },
    { key: 'seen', label: 'Last seen', sortable: true, value: (p) => p.position?.recordedAt || '',
      render: (p) => (p.position ? h('span', { class: 'flex items-center gap-2' }, h('i', { class: `dot-live ${p.position.isStale ? 'off' : ''}` }), fmtRelative(p.position.recordedAt)) : h('span', { class: 'text-muted' }, 'Never')) },
    { key: 'guardians', label: 'Guardians', render: (p) => p.guardians.length },
    { key: 'zones', label: 'Zones', render: (p) => p.geofences.length },
    { key: 'actions', label: '', render: (p) => h('div', { class: 'row-actions' },
      iconButton('edit', `Edit ${p.name}`, () => openPersonForm(p, () => api.reload())),
      iconButton('trash', `Remove ${p.name}`, () => removePerson(p, () => api.reload()))) },
  ],
  async openDetail({ id, api }) { await openPersonDrawer(id, { onClose: api.closeDetail, onChanged: () => api.reload({ quiet: true }) }); },
  live: (api) => {
    const onMove = (d) => {
      updateOpenPersonDrawer(d);
      clearTimeout(reloadTimer); reloadTimer = setTimeout(() => api.reload({ quiet: true }), 1200);
    };
    WsManager.on('asset.location', onMove);
    return () => { clearTimeout(reloadTimer); WsManager.off('asset.location', onMove); };
  },
});
