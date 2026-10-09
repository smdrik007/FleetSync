'use strict';
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { login, api, WS_URL } = require('./helpers');
const prisma = require('../../src/db/client');

let ku, apex, driver, kuVehicles, apexVehicles;
test.before(async () => {
  ku = await login('authority@ku.edu.bd');
  apex = await login('authority@apex.com');
  driver = await login('rahim@ku.edu.bd');
  kuVehicles = (await api(ku.token, 'GET', '/fleet/vehicles')).body.data;
  apexVehicles = (await api(apex.token, 'GET', '/fleet/vehicles')).body.data;
});

// The notification tests create rows for the demo driver; remove them so repeated runs stay clean.
test.after(async () => {
  await prisma.notification.deleteMany({ where: { title: { in: ['Unread A', 'Unread B', 'Live push'] } } });
  await prisma.$disconnect();
});

test('operations: maintenance create (no cost) → filter → update → delete', async () => {
  const c = await api(ku.token, 'POST', '/fleet/maintenance', { vehicleId: kuVehicles[0].id, description: 'Smoke test service', serviceDate: '2026-12-01' });
  assert.strictEqual(c.status, 201, JSON.stringify(c.body));
  assert.strictEqual(c.body.data.cost, null);
  assert.strictEqual(c.body.data.status, 'scheduled');
  const id = c.body.data.id;
  const f = (await api(ku.token, 'GET', '/fleet/maintenance?status=scheduled')).body.data;
  assert.ok(f.some((m) => m.id === id) && f.every((m) => m.status === 'scheduled'));
  const u = await api(ku.token, 'PUT', `/fleet/maintenance/${id}`, { status: 'completed', cost: 1250.5 });
  assert.strictEqual(u.body.data.status, 'completed');
  assert.strictEqual(u.body.data.cost, 1250.5);
  assert.strictEqual((await api(ku.token, 'DELETE', `/fleet/maintenance/${id}`)).status, 200);
});

test('operations: maintenance validates vehicle tenancy, status and cost', async () => {
  const base = { description: 'x', serviceDate: '2026-12-01' };
  const foreign = await api(ku.token, 'POST', '/fleet/maintenance', { ...base, vehicleId: apexVehicles[0].id });
  assert.strictEqual(foreign.status, 422);
  assert.strictEqual(foreign.body.error.code, 'INVALID_VEHICLE');
  assert.strictEqual((await api(ku.token, 'POST', '/fleet/maintenance', { ...base, vehicleId: kuVehicles[0].id, status: 'nope' })).status, 422);
  assert.strictEqual((await api(ku.token, 'POST', '/fleet/maintenance', { ...base, vehicleId: kuVehicles[0].id, cost: -5 })).status, 422);
  assert.strictEqual((await api(ku.token, 'POST', '/fleet/maintenance', { vehicleId: kuVehicles[0].id, serviceDate: '2026-12-01' })).status, 422);
});

test('operations: other tenant cannot update or delete maintenance (404)', async () => {
  const list = (await api(ku.token, 'GET', '/fleet/maintenance')).body.data;
  assert.strictEqual((await api(apex.token, 'PUT', `/fleet/maintenance/${list[0].id}`, { status: 'cancelled' })).status, 404);
  assert.strictEqual((await api(apex.token, 'DELETE', `/fleet/maintenance/${list[0].id}`)).status, 404);
});

test('operations: fuel log records the caller and lists loggedBy', async () => {
  const c = await api(ku.token, 'POST', '/fleet/fuel', { vehicleId: kuVehicles[0].id, volume: 40, totalCost: 4480 });
  assert.strictEqual(c.status, 201, JSON.stringify(c.body));
  assert.strictEqual(c.body.data.loggedBy.id, ku.user.id);
  assert.strictEqual(c.body.data.volume, 40);
  const list = (await api(ku.token, 'GET', `/fleet/fuel?vehicleId=${kuVehicles[0].id}`)).body.data;
  const row = list.find((x) => x.id === c.body.data.id);
  assert.ok(row && row.loggedBy.name);
  assert.strictEqual((await api(ku.token, 'DELETE', `/fleet/fuel/${c.body.data.id}`)).status, 200);
});

test('operations: fuel volume and cost must be positive; vehicle must be in tenant', async () => {
  assert.strictEqual((await api(ku.token, 'POST', '/fleet/fuel', { vehicleId: kuVehicles[0].id, volume: 0, totalCost: 10 })).status, 422);
  assert.strictEqual((await api(ku.token, 'POST', '/fleet/fuel', { vehicleId: kuVehicles[0].id, volume: 10, totalCost: -1 })).status, 422);
  assert.strictEqual((await api(ku.token, 'POST', '/fleet/fuel', { vehicleId: apexVehicles[0].id, volume: 10, totalCost: 10 })).status, 422);
});

test('operations: a driver sees only their own notifications with a matching unreadCount', async () => {
  const r = await api(driver.token, 'GET', '/fleet/notifications');
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.data.items.length >= 3);
  assert.strictEqual(r.body.data.unreadCount, r.body.data.items.filter((n) => !n.isRead).length);
  const authorityView = (await api(ku.token, 'GET', '/fleet/notifications')).body.data.items.map((n) => n.id);
  assert.ok(r.body.data.items.every((n) => !authorityView.includes(n.id)));
});

test('operations: marking someone else\'s notification read is a 404', async () => {
  const mine = (await api(ku.token, 'GET', '/fleet/notifications')).body.data.items[0];
  const r = await api(driver.token, 'POST', `/fleet/notifications/${mine.id}/read`);
  assert.strictEqual(r.status, 404);
});

test('operations: mark one read, then read-all zeroes unreadCount', async () => {
  await api(ku.token, 'POST', '/fleet/notifications', { userId: driver.user.id, title: 'Unread A', message: 'a' });
  await api(ku.token, 'POST', '/fleet/notifications', { userId: driver.user.id, title: 'Unread B', message: 'b' });
  const before = (await api(driver.token, 'GET', '/fleet/notifications?unread=1')).body.data;
  assert.ok(before.items.length >= 2 && before.items.every((n) => !n.isRead));
  const one = await api(driver.token, 'POST', `/fleet/notifications/${before.items[0].id}/read`);
  assert.strictEqual(one.status, 200);
  assert.strictEqual((await api(driver.token, 'GET', '/fleet/notifications')).body.data.unreadCount, before.unreadCount - 1);
  await api(driver.token, 'POST', '/fleet/notifications/read-all');
  assert.strictEqual((await api(driver.token, 'GET', '/fleet/notifications')).body.data.unreadCount, 0);
});

test('operations: only an authority may send notifications, and only within the tenant', async () => {
  assert.strictEqual((await api(driver.token, 'POST', '/fleet/notifications', { userId: ku.user.id, title: 't', message: 'm' })).status, 403);
  assert.strictEqual((await api(ku.token, 'POST', '/fleet/notifications', { userId: apex.user.id, title: 't', message: 'm' })).status, 422);
  assert.strictEqual((await api(ku.token, 'POST', '/fleet/notifications', { userId: driver.user.id, message: 'm' })).status, 422);
});

test('operations: a sent notification is pushed over WebSocket as notification.new', async () => {
  const ws = new WebSocket(`${WS_URL}?token=${driver.token}`);
  const got = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no notification.new within 3s')), 3000);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.event === 'connected') {
        api(ku.token, 'POST', '/fleet/notifications', { userId: driver.user.id, title: 'Live push', message: 'ws test' });
      }
      if (msg.event === 'notification.new') { clearTimeout(timer); resolve(msg.data); }
    });
    ws.on('error', reject);
  });
  try {
    const data = await got;
    assert.strictEqual(data.title, 'Live push');
    assert.strictEqual(data.isRead, false);
  } finally { ws.close(); }
});
