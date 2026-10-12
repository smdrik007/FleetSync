/** Roles & Permissions — `roles`, `permissions`, `role_permissions` (informational: access is gated by role name). */
import { h, pageHead, icon, skeleton, emptyState } from '../ui.js';

export default {
  title: 'Roles & Permissions',

  async render() {
    const [roles, permissions] = await Promise.all([Api.get('/fleet/roles'), Api.get('/fleet/permissions')]);
    const held = await Promise.all(roles.map((r) => Api.get(`/fleet/roles/${r.id}/permissions`).then((ps) => new Set(ps.map((p) => p.code)))));

    const cards = h('div', { class: 'grid-3 mb-4' }, ...roles.map((r, i) => h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, r.name), r.isSystem ? h('span', { class: 'badge badge-purple' }, 'System') : null),
      h('p', { class: 'text-muted' }, r.description || 'No description'),
      h('div', { class: 'flex gap-4 mt-4' },
        h('div', {}, h('div', { class: 'stat-value num' }, String(r.userCount)), h('div', { class: 'stat-label' }, 'Users')),
        h('div', {}, h('div', { class: 'stat-value num' }, String(held[i].size)), h('div', { class: 'stat-label' }, 'Permissions'))))));

    const matrix = permissions.length
      ? h('div', { class: 'table-card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'perm-matrix' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Permission'), ...roles.map((r) => h('th', { scope: 'col' }, r.name)))),
          h('tbody', {}, ...permissions.map((p) => h('tr', {},
            h('td', {}, h('div', { class: 'cell-main' }, p.code), h('div', { class: 'cell-sub' }, p.description || '')),
            ...roles.map((r, i) => h('td', {}, held[i].has(p.code)
              ? h('span', { class: 'check-on', role: 'img', 'aria-label': `${r.name} has ${p.code}` }, icon('check'))
              : h('span', { class: 'check-off', role: 'img', 'aria-label': `${r.name} lacks ${p.code}` }, '—')))))))))
      : emptyState('No permissions defined');

    return h('div', {},
      pageHead({ title: 'Roles & Permissions', subtitle: 'Who can do what in your institution.', count: roles.length }),
      h('div', { class: 'alert alert-info' }, h('span', { class: 'alert-icon' }, icon('info', 'icon-sm')), h('span', {}, 'Permissions are shown for reference. Access today is decided by role: Authority manages the fleet, Drivers run trips, Passengers follow vehicles.')),
      cards, matrix);
  },
};
