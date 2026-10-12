/** Users — `users` (login identities) and their `user_roles`. */
import { makeListView } from './_list.js';
import { Lists, invalidate } from '../data.js';
import { h, badge, link, iconButton, modalForm, fmtDate, initials } from '../ui.js';
import { navigate } from '../router.js';

const roleBadge = (name) => h('span', { class: `badge ${name === 'AUTHORITY' ? 'badge-purple' : name === 'DRIVER' ? 'badge-blue' : 'badge-muted'}` }, name.charAt(0) + name.slice(1).toLowerCase());

async function openUserForm(user, onDone) {
  const roles = await Lists.roles();
  const editing = !!user;
  modalForm({
    title: editing ? `Edit ${user.name}` : 'Add user', submitLabel: editing ? 'Save changes' : 'Add user',
    fields: editing
      ? [{ name: 'name', label: 'Full name', required: true, full: true }, { name: 'phone', label: 'Phone', full: true }]
      : [{ name: 'name', label: 'Full name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true },
         { name: 'phone', label: 'Phone' }, { name: 'password', label: 'Temporary password', type: 'password', required: true, hint: 'At least 8 characters.' },
         { name: 'roleId', label: 'Role', type: 'select', required: true, full: true, options: roles.map((r) => ({ value: r.id, label: `${r.name}${r.description ? ` — ${r.description}` : ''}` })) }],
    errorFields: { EMAIL_EXISTS: 'email', WEAK_PASSWORD: 'password', INVALID_ROLE: 'roleId' },
    initial: editing ? user : {},
    async onSubmit(values) {
      if (editing) await Api.put(`/fleet/users/${user.id}`, values); else await Api.post('/fleet/users', values);
      invalidate(); Toast.success(editing ? 'User updated.' : 'User added.'); onDone();
    },
  });
}

async function openRolesForm(user, onDone) {
  const roles = await Lists.roles();
  modalForm({
    title: `Roles for ${user.name}`, submitLabel: 'Save roles', size: 'modal-sm',
    fields: [{ name: 'roleIds', label: 'Roles', type: 'checkboxes', required: true, full: true, options: roles.map((r) => ({ value: r.id, label: r.name })) }],
    errorFields: { CANNOT_DEMOTE_SELF: 'roleIds', INVALID_ROLE: 'roleIds' },
    initial: { roleIds: user.roleIds },
    async onSubmit(values) { await Api.put(`/fleet/users/${user.id}/roles`, values); invalidate(); Toast.success('Roles updated.'); onDone(); },
  });
}

export default makeListView({
  title: 'Users', subtitle: 'People who can sign in to your institution.', basePath: '/admin/users',
  searchPlaceholder: 'Search name, email, phone…',
  chips: [{ key: 'AUTHORITY', label: 'Authority' }, { key: 'DRIVER', label: 'Driver' }, { key: 'PASSENGER', label: 'Passenger' }],
  // roles are many-to-many, so chips are matched in filterRow instead of chipOf
  filterRow: (u, api) => !api.filter.chip || u.roles.includes(api.filter.chip),
  searchOf: (u) => [u.name, u.email, u.phone, ...u.roles],
  load: () => Api.get('/fleet/users'),
  create: { label: 'Add user', run: (api) => openUserForm(null, () => api.reload()) },
  columns: (api) => [
    { key: 'name', label: 'User', sortable: true, render: (u) => h('div', { class: 'flex items-center gap-3' }, h('span', { class: 'avatar' }, initials(u.name)),
      h('div', {}, h('div', { class: 'cell-main' }, u.name), h('div', { class: 'cell-sub' }, u.email))) },
    { key: 'phone', label: 'Phone', render: (u) => u.phone || '—' },
    { key: 'roles', label: 'Roles', render: (u) => h('div', { class: 'flex gap-1 wrap' }, ...u.roles.map(roleBadge)) },
    { key: 'driverId', label: 'Driver record', render: (u) => (u.driverId ? link('View driver', () => navigate(`/fleet/drivers/${u.driverId}`)) : h('span', { class: 'text-muted' }, '—')) },
    { key: 'createdAt', label: 'Joined', sortable: true, render: (u) => fmtDate(u.createdAt) },
    { key: 'actions', label: '', render: (u) => h('div', { class: 'row-actions' },
      iconButton('shield', `Change roles for ${u.name}`, () => openRolesForm(u, () => api.reload())),
      iconButton('edit', `Edit ${u.name}`, () => openUserForm(u, () => api.reload()))) },
  ],
});
