/** Notifications — `notifications` for the signed-in user; authorities can also send one to any user. */
import { makeListView } from './_list.js';
import { Lists } from '../data.js';
import { h, button, iconButton, modalForm, fmtRelative, fmtDateTime } from '../ui.js';

const changed = () => window.dispatchEvent(new Event('fs:notifications-changed'));

async function openSendForm(onDone) {
  const users = await Lists.users();
  modalForm({
    title: 'Send notification', submitLabel: 'Send',
    fields: [
      { name: 'userId', label: 'Recipient', type: 'select', required: true, full: true, options: users.map((u) => ({ value: u.id, label: `${u.name} — ${u.roles.join(', ')}` })) },
      { name: 'title', label: 'Title', required: true, full: true },
      { name: 'message', label: 'Message', type: 'textarea', required: true, full: true },
    ],
    errorFields: { INVALID_USER: 'userId' },
    async onSubmit(values) { await Api.post('/fleet/notifications', values); Toast.success('Notification sent.'); onDone(); },
  });
}

async function markRead(n, api) {
  try { await Api.post(`/fleet/notifications/${n.id}/read`); changed(); api.reload({ quiet: true }); }
  catch (err) { Toast.error(err.message); }
}

export default makeListView({
  title: 'Notifications', subtitle: 'Alerts addressed to you. New ones arrive live.', basePath: '/operations/notifications',
  searchPlaceholder: 'Search notifications…',
  chips: [{ key: 'unread', label: 'Unread' }, { key: 'read', label: 'Read' }], chipOf: (n) => (n.isRead ? 'read' : 'unread'),
  searchOf: (n) => [n.title, n.message],
  load: async () => (await Api.get('/fleet/notifications')).items,
  create: { label: 'Send notification', run: (api) => openSendForm(() => api.reload()) },
  toolbar: (api) => [button('Mark all read', { iconName: 'check', onClick: async () => {
    try { await Api.post('/fleet/notifications/read-all'); changed(); api.reload({ quiet: true }); Toast.success('All caught up.'); } catch (err) { Toast.error(err.message); }
  } })],
  emptyText: 'No notifications.',
  columns: (api) => [
    { key: 'title', label: 'Notification', sortable: true, render: (n) => h('div', {}, h('div', { class: n.isRead ? '' : 'cell-main' }, n.title), h('div', { class: 'cell-sub' }, n.message)) },
    { key: 'createdAt', label: 'Received', sortable: true, render: (n) => h('span', { title: fmtDateTime(n.createdAt) }, fmtRelative(n.createdAt)) },
    { key: 'isRead', label: 'Status', sortable: true, render: (n) => h('span', { class: `badge badge-dot ${n.isRead ? 'badge-muted' : 'badge-blue'}` }, n.isRead ? 'Read' : 'Unread') },
    { key: 'actions', label: '', render: (n) => (n.isRead ? '' : h('div', { class: 'row-actions' }, iconButton('check', `Mark "${n.title}" as read`, () => markRead(n, api)))) },
  ],
  live: (api) => {
    const onNew = () => api.reload({ quiet: true });
    WsManager.on('notification.new', onNew);
    window.addEventListener('fs:notifications-changed', onNew);
    return () => { WsManager.off('notification.new', onNew); window.removeEventListener('fs:notifications-changed', onNew); };
  },
});
