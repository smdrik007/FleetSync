/** Routes — `routes` + ordered `route_stops`; the drawer holds an ordered-stop editor with a map. */
import { makeListView } from './_list.js';
import { Lists, invalidate } from '../data.js';
import { h, kv, miniList, miniRow, button, iconButton, modalForm, confirmDialog, fmtDate, icon, closeDrawer } from '../ui.js';
import { createMap, numberedMarker, fitTo } from '../maps.js';
import { navigate } from '../router.js';

function openRouteForm(route, onDone) {
  const editing = !!route;
  modalForm({
    title: editing ? `Edit route` : 'Add route', submitLabel: editing ? 'Save changes' : 'Create route',
    fields: [{ name: 'name', label: 'Route name', required: true, full: true, placeholder: 'Sonadanga → Campus' },
      { name: 'description', label: 'Description', type: 'textarea', full: true }],
    errorFields: { DUPLICATE: 'name' }, initial: route || {},
    async onSubmit(values) {
      if (editing) await Api.put(`/fleet/routes/${route.id}`, values); else await Api.post('/fleet/routes', values);
      invalidate(); Toast.success(editing ? 'Route updated.' : 'Route created. Open it to add stops.'); onDone();
    },
  });
}

async function removeRoute(route, onDone) {
  if (!(await confirmDialog(`Delete "${route.name}"? Vehicles on it become unassigned; past trips keep their history.`))) return;
  try { await Api.delete(`/fleet/routes/${route.id}`); invalidate(); Toast.success('Route deleted.'); onDone(); }
  catch (err) { Toast.error(err.message); }
}

/** The ordered stop editor + map. Returns the root node and a cleanup for the map. */
function stopEditor(route, allStops, onSaved) {
  let order = route.stops.map((s) => s.stopId);
  const byId = new Map(allStops.map((s) => [s.id, s]));
  let dirty = false;

  const mapEl = h('div', { class: 'map-box short' });
  const list = h('div', { class: 'reorder' });
  const addSel = h('select', { class: 'form-select', 'aria-label': 'Add a stop' });
  const saveBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: true }, 'Save order');
  const root = h('div', {}, mapEl, h('div', { class: 'mt-3' }, list),
    h('div', { class: 'flex gap-2 mt-3' }, h('div', { class: 'grow' }, addSel), saveBtn));

  const map = createMap(mapEl, { zoom: 12 });
  const layer = L.layerGroup().addTo(map);

  function paint() {
    // list
    list.replaceChildren(...(order.length ? order.map((id, i) => {
      const s = byId.get(id);
      const move = (d) => { const j = i + d; if (j < 0 || j >= order.length) return; [order[i], order[j]] = [order[j], order[i]]; dirty = true; paint(); };
      return h('div', { class: 'reorder-item' }, h('span', { class: 'idx' }, String(i + 1)), h('span', { class: 'grow truncate' }, s?.name || 'Unknown stop'),
        iconButton('up', `Move ${s?.name} up`, () => move(-1)), iconButton('down', `Move ${s?.name} down`, () => move(1)),
        iconButton('x', `Remove ${s?.name}`, () => { order.splice(i, 1); dirty = true; paint(); }));
    }) : [h('p', { class: 'section-empty' }, 'No stops yet — add the first one below.')]));
    // add select (stops not yet on the route)
    const free = allStops.filter((s) => !order.includes(s.id));
    addSel.replaceChildren(h('option', { value: '' }, free.length ? 'Add a stop…' : 'All stops are on this route'), ...free.map((s) => h('option', { value: s.id }, s.name)));
    addSel.disabled = !free.length;
    saveBtn.disabled = !dirty || !order.length;
    // map
    layer.clearLayers();
    const pts = order.map((id) => byId.get(id)).filter(Boolean).map((s) => [s.latitude, s.longitude]);
    pts.forEach((p, i) => numberedMarker(p, i + 1).addTo(layer));
    if (pts.length > 1) L.polyline(pts, { color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), weight: 4, opacity: 0.85 }).addTo(layer);
    fitTo(map, pts, { maxZoom: 14 });
    // The drawer is still sliding in on first paint, so re-measure and re-fit once it has settled.
    setTimeout(() => { if (map._container?.isConnected) { map.invalidateSize(); fitTo(map, pts, { maxZoom: 14 }); } }, 450);
  }

  addSel.addEventListener('change', () => { if (addSel.value) { order.push(addSel.value); dirty = true; paint(); } });
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try { await Api.put(`/fleet/routes/${route.id}/stops`, { stopIds: order }); invalidate(); Toast.success('Stop order saved.'); dirty = false; onSaved(); }
    catch (err) { Toast.error(err.message); saveBtn.disabled = false; }
    saveBtn.textContent = 'Save order';
  });
  paint();
  return { root, destroy: () => map.remove() };
}

let activeEditor = null;

export default makeListView({
  title: 'Routes', subtitle: 'Named routes and the ordered stops that make them up.', basePath: '/fleet/routes',
  searchPlaceholder: 'Search routes…', searchOf: (r) => [r.name, r.description],
  load: () => Api.get('/fleet/routes'),
  create: { label: 'Add route', run: (api) => openRouteForm(null, () => api.reload()) },
  columns: (api) => [
    { key: 'name', label: 'Route', sortable: true, render: (r) => h('div', {}, h('div', { class: 'cell-main' }, r.name), r.description ? h('div', { class: 'cell-sub' }, r.description) : null) },
    { key: 'stopCount', label: 'Stops', sortable: true, align: 'num' },
    { key: 'vehicleCount', label: 'Vehicles', sortable: true, align: 'num' },
    { key: 'createdAt', label: 'Created', sortable: true, render: (r) => fmtDate(r.createdAt) },
    { key: 'actions', label: '', render: (r) => h('div', { class: 'row-actions' },
      iconButton('edit', `Edit ${r.name}`, () => openRouteForm(r, () => api.reload())),
      iconButton('trash', `Delete ${r.name}`, () => removeRoute(r, () => api.reload()))) },
  ],
  async openDetail({ id, api }) {
    const [route, stops] = await Promise.all([Api.get(`/fleet/routes/${id}`), Lists.stops()]);
    activeEditor?.destroy();
    activeEditor = stopEditor(route, stops, () => { api.reload({ quiet: true }); api.openDetail(id); });
    api.drawer({
      title: route.name, subtitle: route.description || `${route.stopCount} stops · ${route.vehicleCount} vehicles`,
      actions: [button('Edit', { iconName: 'edit', onClick: () => openRouteForm(route, () => { api.reload({ quiet: true }); api.openDetail(id); }) }),
        button('Delete', { variant: 'danger', iconName: 'trash', onClick: () => removeRoute(route, () => { api.reload(); api.closeDetail(); }) })],
      sections: [
        { heading: 'Stops in order', content: activeEditor.root },
        { heading: `Vehicles on this route (${route.vehicles.length})`, content: miniList(route.vehicles.map((v) => miniRow(h('div', { class: 'cell-main' }, v.vehicleNumber), null, () => navigate(`/fleet/vehicles/${v.id}`))), { empty: 'No vehicles assigned.' }) },
      ],
    });
  },
  live: () => () => { activeEditor?.destroy(); activeEditor = null; closeDrawer({ silent: true }); },
});
