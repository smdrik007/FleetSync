/** Subscription — `subscriptions` (current plan card + history). */
import { h, pageHead, badge, dataTable, emptyState, fmtDate, daysUntil, icon } from '../ui.js';

export default {
  title: 'Subscription',

  async render() {
    const { current, history } = await Api.get('/fleet/subscription');
    if (!current) return h('div', {}, pageHead({ title: 'Subscription' }), emptyState('No subscription on record', 'Contact FleetSync support to activate a plan.'));

    const start = new Date(current.startDate).getTime();
    const end = current.endDate ? new Date(current.endDate).getTime() : null;
    const pct = end ? Math.min(100, Math.max(0, Math.round(((Date.now() - start) / (end - start)) * 100))) : 0;
    const left = current.endDate ? daysUntil(current.endDate) : null;
    const warn = left !== null && left <= 30;

    const plan = h('div', { class: 'card plan-card mb-4' },
      h('div', { class: 'flex justify-between items-center wrap gap-3' },
        h('div', {}, h('div', { class: 'text-muted' }, 'Current plan'), h('h1', { style: { marginTop: '4px' } }, current.planName)),
        badge(current.status)),
      h('div', { class: 'grid-3 mt-4' },
        h('div', {}, h('div', { class: 'stat-label' }, 'Started'), h('div', { class: 'cell-main' }, fmtDate(current.startDate))),
        h('div', {}, h('div', { class: 'stat-label' }, 'Renews / ends'), h('div', { class: 'cell-main' }, current.endDate ? fmtDate(current.endDate) : 'No end date')),
        h('div', {}, h('div', { class: 'stat-label' }, 'Time left'), h('div', { class: 'cell-main', style: { color: warn ? 'var(--amber)' : '' } }, left === null ? '—' : left < 0 ? `Expired ${-left} days ago` : `${left} days`))),
      end ? h('div', { class: 'mt-4' }, h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Subscription period elapsed' }, h('i', { style: { width: `${pct}%` } })),
        h('p', { class: 'text-muted mt-2' }, `${pct}% of the current period used`)) : null,
      warn ? h('div', { class: 'alert alert-warning mt-4' }, h('span', { class: 'alert-icon' }, icon('alert', 'icon-sm')), h('span', {}, 'Your plan ends soon. Contact FleetSync to renew so tracking is not interrupted.')) : null);

    const table = dataTable({
      pageSize: 10, rows: history,
      columns: [
        { key: 'planName', label: 'Plan', sortable: true, render: (s) => h('span', { class: 'cell-main' }, s.planName) },
        { key: 'status', label: 'Status', sortable: true, render: (s) => badge(s.status) },
        { key: 'startDate', label: 'Start', sortable: true, render: (s) => fmtDate(s.startDate) },
        { key: 'endDate', label: 'End', sortable: true, render: (s) => (s.endDate ? fmtDate(s.endDate) : '—') },
      ],
    });

    return h('div', {}, pageHead({ title: 'Subscription', subtitle: 'Your FleetSync plan and billing history.' }), plan, h('h3', { class: 'mb-3' }, 'History'), table);
  },
};
