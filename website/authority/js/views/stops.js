/** Stops — `stops` (name + coordinates). The form includes a click-to-place map. */
import { makeListView } from './_list.js';
import { invalidate } from '../data.js';
import { h, iconButton, modalForm, confirmDialog, fmtNumber } from '../ui.js';
import { pickerMap } from '../maps.js';

function openStopForm(stop, onDone) {
  const editing = !!stop;
  const ctl = modalForm({
    title: editing ? `Edit ${stop.name}` : 'Add stop', submitLabel: editing ? 'Save changes' : 'Add stop',
    fields: [
      { name: 'name', label: 'Stop name', required: true, full: true, placeholder: 'KU Main Gate' },
      { name: 'latitude', label: 'Latitude', type: 'number', required: true, step: 'any', hint: 'Click the map to fill both' },
      { name: 'longitude', label: 'Longitude', type: 'number', required: true, step: 'any' },
    ],
    errorFields: { INVALID_LATITUDE: 'latitude', INVALID_LONGITUDE: 'longitude' },
    initial: stop || {},
    async onSubmit(values) {
      if (editing) await Api.put(`/fleet/stops/${stop.id}`, values); else await Api.post('/fleet/stops', values);
      invalidate(); Toast.success(editing ? 'Stop updated.' : 'Stop added.'); onDone();
    },
  });
  const lat = ctl.modal.querySelector('#f-latitude');
  const lng = ctl.modal.querySelector('#f-longitude');
  const picker = pickerMap({
    lat: stop?.latitude, lng: stop?.longitude,
    onPick: (la, lo) => { lat.value = la; lng.value = lo; lat.classList.remove('invalid'); lng.classList.remove('invalid'); },
  });
  ctl.modal.querySelector('.modal-body').prepend(picker.el);
  const sync = () => { const la = parseFloat(lat.value); const lo = parseFloat(lng.value); if (Number.isFinite(la) && Number.isFinite(lo)) picker.setPosition(la, lo); };
  lat.addEventListener('change', sync); lng.addEventListener('change', sync);
  const close = ctl.close;
  ctl.close = () => { picker.map.remove(); close(); };
  // modalForm's own handlers call ctl.close() via its closure, so also clean up when the overlay is removed.
  new MutationObserver((_, obs) => { if (!document.body.contains(ctl.overlay)) { try { picker.map.remove(); } catch { /* already removed */ } obs.disconnect(); } }).observe(document.body, { childList: true });
}

async function removeStop(stop, onDone) {
  if (!(await confirmDialog(`Delete stop "${stop.name}"?`))) return;
  try { await Api.delete(`/fleet/stops/${stop.id}`); invalidate(); Toast.success('Stop deleted.'); onDone(); }
  catch (err) { Toast.error(err.message); }
}

export default makeListView({
  title: 'Stops', subtitle: 'Pick-up points that routes are built from.', basePath: '/fleet/stops',
  searchPlaceholder: 'Search stops…', searchOf: (s) => [s.name],
  load: () => Api.get('/fleet/stops'),
  create: { label: 'Add stop', run: (api) => openStopForm(null, () => api.reload()) },
  columns: (api) => [
    { key: 'name', label: 'Stop', sortable: true, render: (s) => h('span', { class: 'cell-main' }, s.name) },
    { key: 'latitude', label: 'Latitude', sortable: true, align: 'num', render: (s) => fmtNumber(s.latitude, 5) },
    { key: 'longitude', label: 'Longitude', sortable: true, align: 'num', render: (s) => fmtNumber(s.longitude, 5) },
    { key: 'routeCount', label: 'Used by routes', sortable: true, align: 'num' },
    { key: 'actions', label: '', render: (s) => h('div', { class: 'row-actions' },
      iconButton('edit', `Edit ${s.name}`, () => openStopForm(s, () => api.reload())),
      iconButton('trash', `Delete ${s.name}`, () => removeStop(s, () => api.reload()))) },
  ],
});
