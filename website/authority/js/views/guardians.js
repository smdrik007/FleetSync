/** Guardians — who may follow whom. Each guardian sees only the people ticked here, on the /guardian page. */
import { makeListView } from './_list.js';
import { invalidate } from '../data.js';
import { h, iconButton, modalForm, modalShell, confirmDialog, titleCase, fmtDate } from '../ui.js';
import { navigate } from '../router.js';

const followsText = (g) => g.people.map((p) => (p.relationship ? `${p.name} (${p.relationship})` : p.name));

function openInfoForm(guardian, onDone) {
  const editing = !!guardian;
  modalForm({
    title: editing ? 'Edit guardian' : 'Add guardian', submitLabel: editing ? 'Save changes' : 'Next: choose people',
    fields: [
      { name: 'name', label: 'Full name', required: true },
      { name: 'phone', label: 'Phone', type: 'tel', placeholder: '+8801…' },
      ...(editing ? [] : [
        { name: 'email', label: 'Email (sign-in)', type: 'email', required: true },
        { name: 'password', label: 'Temporary password', type: 'password', required: true, hint: 'At least 8 characters. Share it privately and ask them to change it.' },
      ]),
    ],
    errorFields: { EMAIL_EXISTS: 'email', WEAK_PASSWORD: 'password' },
    initial: guardian || {},
    async onSubmit(v) {
      if (editing) { await Api.put(`/fleet/guardians/${guardian.id}`, v); Toast.success('Guardian updated.'); onDone(); return; }
      const created = await Api.post('/fleet/guardians', { ...v, links: [] });
      invalidate(); onDone();
      setTimeout(() => openPeopleDialog(created, onDone), 50);   // straight on to who they may follow
    },
  });
}

/** Tick the people this guardian may follow, each with an optional relationship. */
async function openPeopleDialog(guardian, onDone) {
  const people = await Api.get('/fleet/people');
  const current = new Map(guardian.people.map((p) => [p.id, p.relationship || '']));
  const rows = people.map((p) => {
    const box = h('input', { type: 'checkbox', checked: current.has(p.id), 'aria-label': `May follow ${p.name}` });
    const rel = h('input', { class: 'form-input', placeholder: 'Relationship (Mother, Teacher…)', value: current.get(p.id) || '', 'aria-label': `Relationship to ${p.name}`, style: { maxWidth: '220px' } });
    rel.disabled = !box.checked;
    box.addEventListener('change', () => { rel.disabled = !box.checked; if (box.checked) rel.focus(); });
    return { p, box, rel, el: h('label', { class: 'flex items-center gap-2', style: { padding: '8px 0', borderTop: '1px solid var(--border)' } },
      box, h('div', { class: 'grow' }, h('div', { class: 'cell-main' }, p.name), h('div', { class: 'cell-sub' }, `${p.code ? `ID ${p.code} · ` : ''}${titleCase(p.kind)}${p.consentAt ? '' : ' · consent not recorded'}`)), rel) };
  });
  // Search by name, ID number or system id narrows the list only; ticked people stay ticked while hidden.
  const count = h('span', { class: 'text-xs text-muted' });
  const empty = h('p', { class: 'section-empty hidden' }, 'No one matches that search.');
  const paintCount = () => { count.textContent = `${rows.filter((r) => r.box.checked).length} selected`; };
  const search = h('input', { class: 'form-input', type: 'search', placeholder: 'Search by name or ID number…', 'aria-label': 'Search people by name or ID', autocomplete: 'off' });
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    rows.forEach((r) => { const hit = !q || [r.p.name, r.p.code, r.p.id, r.p.notes].some((v) => String(v ?? '').toLowerCase().includes(q)); r.el.classList.toggle('hidden', !hit); if (hit) shown += 1; });
    empty.classList.toggle('hidden', shown > 0);
  });
  rows.forEach((r) => r.box.addEventListener('change', paintCount));
  paintCount();
  const banner = h('div', { class: 'alert alert-danger hidden', role: 'alert' });
  const save = h('button', { class: 'btn btn-primary', type: 'button' }, 'Save');
  const ctl = modalShell({
    title: `Who can ${guardian.name} follow?`,
    body: h('div', { class: 'modal-body' }, banner,
      h('p', { class: 'text-sm text-muted', style: { marginTop: 0 } }, 'They will see live location, safe zones and alerts only for the people ticked here. Unticking removes access at once.'),
      rows.length
        ? h('div', {}, h('div', { class: 'flex gap-2 items-center', style: { marginBottom: '8px' } }, h('div', { class: 'grow' }, search), count),
          h('div', { style: { maxHeight: '50vh', overflowY: 'auto', overflowX: 'hidden' } }, ...rows.map((r) => r.el), empty))
        : h('p', { class: 'section-empty' }, 'No people yet. Add them on the People screen first.')),
    foot: h('div', { class: 'modal-foot' }, h('button', { class: 'btn btn-outline', type: 'button', onclick: () => ctl.close() }, 'Cancel'), save),
  });
  if (rows.length) setTimeout(() => search.focus(), 30);
  save.onclick = async () => {
    save.disabled = true;
    try {
      const links = rows.filter((r) => r.box.checked).map((r) => ({ assetId: r.p.id, relationship: r.rel.value.trim() || null }));
      await Api.put(`/fleet/guardians/${guardian.id}/people`, { links });
      invalidate(); Toast.success('Access updated.'); ctl.close(); onDone();
    } catch (err) { banner.textContent = err.message; banner.classList.remove('hidden'); save.disabled = false; }
  };
}

async function removeGuardian(g, onDone) {
  if (!(await confirmDialog(`Remove ${g.name}? Their sign-in is deleted and they lose access to everyone they follow.`, { confirmLabel: 'Remove' }))) return;
  try { await Api.delete(`/fleet/guardians/${g.id}`); invalidate(); Toast.success('Guardian removed.'); onDone(); }
  catch (err) { Toast.error(err.message); }
}

export default makeListView({
  title: 'Guardians', subtitle: 'Family members and carers, and exactly who each one may follow.', basePath: '/tracking/guardians',
  searchPlaceholder: 'Search name, email, phone, person…',
  chips: [{ key: 'linked', label: 'Following someone' }, { key: 'none', label: 'No access' }],
  chipOf: (g) => (g.people.length ? 'linked' : 'none'),
  searchOf: (g) => [g.name, g.email, g.phone, ...followsText(g)],
  load: () => Api.get('/fleet/guardians'),
  create: { label: 'Add guardian', run: (api) => openInfoForm(null, () => api.reload()) },
  emptyText: 'No guardians yet. Add one, then choose who they may follow.',
  columns: (api) => [
    { key: 'name', label: 'Guardian', sortable: true, render: (g) => h('div', {}, h('div', { class: 'cell-main' }, g.name), h('div', { class: 'cell-sub' }, g.email)) },
    { key: 'phone', label: 'Phone', render: (g) => (g.phone ? h('a', { href: `tel:${g.phone}` }, g.phone) : h('span', { class: 'text-muted' }, '—')) },
    { key: 'people', label: 'May follow', render: (g) => (g.people.length
      ? h('div', { class: 'flex gap-2 wrap' }, ...g.people.map((p) => h('button', { class: 'badge badge-muted', type: 'button', style: { cursor: 'pointer', border: 0 }, onclick: (e) => { e.stopPropagation(); navigate(`/tracking/people/${p.id}`); } },
        p.relationship ? `${p.name} · ${p.relationship}` : p.name)))
      : h('span', { class: 'text-muted' }, 'No one (no access)')) },
    { key: 'createdAt', label: 'Added', sortable: true, render: (g) => fmtDate(g.createdAt) },
    { key: 'actions', label: '', render: (g) => h('div', { class: 'row-actions' },
      iconButton('users', `Choose who ${g.name} may follow`, () => openPeopleDialog(g, () => api.reload())),
      iconButton('edit', `Edit ${g.name}`, () => openInfoForm(g, () => api.reload())),
      iconButton('trash', `Remove ${g.name}`, () => removeGuardian(g, () => api.reload()))) },
  ],
});
