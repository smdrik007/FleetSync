'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { login, api, ensureEmptyTenant } = require('./helpers');

let ku, apex, empty, kuVehicles, apexVehicles;
test.before(async () => {
  ku = await login('authority@ku.edu.bd');
  apex = await login('authority@apex.com');
  empty = await ensureEmptyTenant();
  kuVehicles = (await api(ku.token, 'GET', '/fleet/vehicles')).body.data;
  apexVehicles = (await api(apex.token, 'GET', '/fleet/vehicles')).body.data;
});
const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 1000)}`;

test('tracking: trips list is newest-first and filters by status', async () => {
  const all = (await api(ku.token, 'GET', '/fleet/trips')).body.data;
  assert.ok(all.length >= 5);
  const times = all.map((t) => new Date(t.startedAt).getTime());
  assert.deepStrictEqual(times, [...times].sort((a, b) => b - a));
  assert.ok(all.some((t) => t.status === 'in_progress'));
  const done = (await api(ku.token, 'GET', '/fleet/trips?status=completed')).body.data;
  assert.ok(done.length >= 5 && done.every((t) => t.status === 'completed'));
  assert.ok(done[0].vehicle.vehicleNumber && done[0].driver.name);
});

test('tracking: invalid trip status filter is a 422', async () => {
  assert.strictEqual((await api(ku.token, 'GET', '/fleet/trips?status=flying')).status, 422);
  assert.strictEqual((await api(ku.token, 'GET', '/fleet/trips?from=not-a-date')).status, 422);
});

test('tracking: completed trip detail has pointCount and an ordered numeric track', async () => {
  const t = (await api(ku.token, 'GET', '/fleet/trips?status=completed')).body.data[0];
  const d = await api(ku.token, 'GET', `/fleet/trips/${t.id}`);
  assert.strictEqual(d.status, 200);
  assert.ok(d.body.data.pointCount >= 20);
  assert.strictEqual(typeof d.body.data.durationMinutes, 'number');
  const tr = await api(ku.token, 'GET', `/fleet/trips/${t.id}/track`);
  assert.strictEqual(tr.status, 200);
  const pts = tr.body.data;
  assert.ok(pts.length >= 20);
  assert.strictEqual(typeof pts[0].lat, 'number');
  assert.strictEqual(typeof pts[0].lng, 'number');
  const ts = pts.map((p) => new Date(p.recordedAt).getTime());
  assert.deepStrictEqual(ts, [...ts].sort((a, b) => a - b));
});

test('tracking: a trip with zero GPS points returns an empty track (200)', async () => {
  const prisma = require('../../src/db/client');
  const driver = await prisma.driver.findFirst({ where: { institutionId: ku.institutionId } });
  const trip = await prisma.trip.create({ data: { institutionId: ku.institutionId, vehicleId: kuVehicles[0].id, driverId: driver.id, status: 'scheduled' } });
  try {
    const tr = await api(ku.token, 'GET', `/fleet/trips/${trip.id}/track`);
    assert.strictEqual(tr.status, 200);
    assert.deepStrictEqual(tr.body.data, []);
    const d = await api(ku.token, 'GET', `/fleet/trips/${trip.id}`);
    assert.strictEqual(d.body.data.pointCount, 0);
    assert.strictEqual(d.body.data.durationMinutes, null);
  } finally { await prisma.trip.delete({ where: { id: trip.id } }); }
});

test('tracking: another tenant cannot read a trip or its track (404)', async () => {
  const t = (await api(ku.token, 'GET', '/fleet/trips')).body.data[0];
  assert.strictEqual((await api(apex.token, 'GET', `/fleet/trips/${t.id}`)).status, 404);
  assert.strictEqual((await api(apex.token, 'GET', `/fleet/trips/${t.id}/track`)).status, 404);
});

test('tracking: filtering by another tenant\'s vehicleId yields an empty list, not an error', async () => {
  const r = await api(ku.token, 'GET', `/fleet/trips?vehicleId=${apexVehicles[0].id}`);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.data, []);
});

test('tracking: device create / update / delete with validation', async () => {
  const imei = uniq('99');
  const c = await api(ku.token, 'POST', '/fleet/devices', { vehicleId: kuVehicles[0].id, deviceType: 'GPS Tracker', imei });
  assert.strictEqual(c.status, 201, JSON.stringify(c.body));
  assert.strictEqual(c.body.data.status, 'active');
  const id = c.body.data.id;
  assert.strictEqual((await api(ku.token, 'POST', '/fleet/devices', { vehicleId: kuVehicles[0].id, deviceType: 'GPS', imei })).status, 409);
  assert.strictEqual((await api(ku.token, 'PUT', `/fleet/devices/${id}`, { status: 'broken' })).status, 422);
  const u = await api(ku.token, 'PUT', `/fleet/devices/${id}`, { status: 'faulty', firmwareVersion: '9.9' });
  assert.strictEqual(u.body.data.status, 'faulty');
  assert.strictEqual((await api(apex.token, 'PUT', `/fleet/devices/${id}`, { status: 'active' })).status, 404);
  assert.strictEqual((await api(ku.token, 'DELETE', `/fleet/devices/${id}`)).status, 200);
});

test('tracking: a device cannot be attached to another tenant\'s vehicle (422)', async () => {
  const r = await api(ku.token, 'POST', '/fleet/devices', { vehicleId: apexVehicles[0].id, deviceType: 'GPS', imei: uniq('98') });
  assert.strictEqual(r.status, 422);
  assert.strictEqual(r.body.error.code, 'INVALID_VEHICLE');
});

test('tracking: devices list exposes isOnline from lastSeenAt', async () => {
  const d = (await api(ku.token, 'GET', '/fleet/devices')).body.data;
  assert.ok(d.length >= 2);
  assert.strictEqual(typeof d[0].isOnline, 'boolean');
  assert.ok(d[0].vehicle.vehicleNumber);
});

test('tracking: positions include the live vehicle with a consistent isStale flag', async () => {
  const p = (await api(ku.token, 'GET', '/fleet/positions')).body.data;
  const live = p.find((x) => x.tripId);
  assert.ok(live, 'expected a vehicle on a trip');
  assert.strictEqual(typeof live.lat, 'number');
  assert.strictEqual(typeof live.lng, 'number');
  assert.strictEqual(live.isStale, Date.now() - new Date(live.recordedAt).getTime() > 5 * 60 * 1000);
  assert.ok(live.vehicleNumber && live.status);
  const apexPos = (await api(apex.token, 'GET', '/fleet/positions')).body.data;
  assert.ok(!apexPos.some((x) => x.vehicleId === live.vehicleId));
});

test('tracking: a tenant with no fleet gets empty lists (200), not a 500', async () => {
  for (const path of ['/fleet/vehicles', '/fleet/positions', '/fleet/trips', '/fleet/devices']) {
    const r = await api(empty.token, 'GET', path);
    assert.strictEqual(r.status, 200, path);
    assert.deepStrictEqual(r.body.data, [], path);
  }
});
