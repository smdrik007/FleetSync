/** Vehicle Models — `vehicle_models`. Global catalog rows (institution_id NULL) are shown read-only. */
import { makeListView } from './_list.js';
import { invalidate } from '../data.js';
import { h, badge, iconButton, modalForm, confirmDialog, fmtNumber } from '../ui.js';

const FUEL_TYPES = ['diesel', 'petrol', 'cng', 'lpg', 'hybrid', 'electric'];

function openModelForm(model, onDone) {
  const editing = !!model;
  modalForm({
    title: editing ? `Edit ${model.make} ${model.model}` : 'Add vehicle model', submitLabel: editing ? 'Save changes' : 'Add model',
    fields: [
      { name: 'make', label: 'Make', required: true, placeholder: 'Toyota' },
      { name: 'model', label: 'Model', required: true, placeholder: 'HiAce' },
      { name: 'year', label: 'Year', type: 'number', min: 1980, max: 2100, placeholder: '2024' },
      { name: 'capacity', label: 'Capacity (seats)', type: 'number', min: 1, placeholder: '40' },
      { name: 'fuelType', label: 'Fuel type', type: 'select', emptyLabel: 'Not specified', options: FUEL_TYPES.map((f) => ({ value: f, label: f.toUpperCase() === 'CNG' || f === 'lpg' ? f.toUpperCase() : f[0].toUpperCase() + f.slice(1) })) },
    ],
    errorFields: { INVALID_YEAR: 'year', INVALID_CAPACITY: 'capacity' },
    initial: model || {},
    async onSubmit(values) {
      if (editing) await Api.put(`/fleet/models/${model.id}`, values); else await Api.post('/fleet/models', values);
      invalidate(); Toast.success(editing ? 'Model updated.' : 'Model added.'); onDone();
    },
  });
}

async function removeModel(model, onDone) {
  if (!(await confirmDialog(`Delete ${model.make} ${model.model}?`))) return;
  try { await Api.delete(`/fleet/models/${model.id}`); invalidate(); Toast.success('Model deleted.'); onDone(); }
  catch (err) { Toast.error(err.message); }
}

export default makeListView({
  title: 'Vehicle Models', subtitle: 'Your own models plus the shared platform catalog.', basePath: '/fleet/models',
  searchPlaceholder: 'Search make or model…',
  chips: [{ key: 'custom', label: 'Yours' }, { key: 'global', label: 'Catalog' }], chipOf: (m) => (m.isGlobal ? 'global' : 'custom'),
  searchOf: (m) => [m.make, m.model, m.fuelType, m.year],
  load: () => Api.get('/fleet/models'),
  create: { label: 'Add model', run: (api) => openModelForm(null, () => api.reload()) },
  columns: (api) => [
    { key: 'model', label: 'Model', sortable: true, value: (m) => `${m.make} ${m.model}`,
      render: (m) => h('div', { class: 'flex items-center gap-2' }, h('div', {}, h('div', { class: 'cell-main' }, `${m.make} ${m.model}`)), m.isGlobal ? badge('catalog', 'Catalog') : null) },
    { key: 'year', label: 'Year', sortable: true },
    { key: 'fuelType', label: 'Fuel', sortable: true, render: (m) => m.fuelType || '—' },
    { key: 'capacity', label: 'Capacity', sortable: true, align: 'num', render: (m) => (m.capacity ? `${m.capacity} seats` : '—') },
    { key: 'vehicleCount', label: 'In your fleet', sortable: true, align: 'num', render: (m) => fmtNumber(m.vehicleCount) },
    { key: 'actions', label: '', render: (m) => (m.isGlobal ? '' : h('div', { class: 'row-actions' },
      iconButton('edit', `Edit ${m.model}`, () => openModelForm(m, () => api.reload())),
      iconButton('trash', `Delete ${m.model}`, () => removeModel(m, () => api.reload())))) },
  ],
});
