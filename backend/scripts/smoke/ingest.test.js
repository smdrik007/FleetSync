'use strict';
// Device ingest: key auth, tenant safety, units, replay, and the device-type catalog.
const test = require('node:test');
const assert = require('node:assert');
const { API_BASE, login, api } = require('./helpers');
const prisma = require('../../src/db/client');
const { Prisma } = require('@prisma/client');

test.after(async () => { await prisma.$disconnect(); });

const raw = (path, { method = 'POST', key, body, headers = {} } = {}) =>
  fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const uniq = () => `ing-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

async function newDevice(ku, vehicleId, deviceType, extra = {}) {
  const imei = uniq();
  const r = await api(ku.token, 'POST', '/fleet/devices', { vehicleId, deviceType, imei, ...extra });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  return { ...r.body.data, imei };
}

// Tests use a throwaway vehicle so the seeded fleet keeps its own positions.
async function tempVehicle(ku) {
  const n = uniq();
  const model = (await api(ku.token, 'GET', '/fleet/models')).body.data[0];
  const r = await api(ku.token, 'POST', '/fleet/vehicles', { vehicleNumber: n.slice(-12), plateNumber: n, modelId: model.id });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
}

async function cleanup(deviceIds, vehicleId) {
  await prisma.gpsLog.deleteMany({ where: { vehicleId } });
  await prisma.vehicleLatestPosition.deleteMany({ where: { vehicleId } });
  await prisma.device.deleteMany({ where: { id: { in: deviceIds } } });
  await prisma.vehicle.delete({ where: { id: vehicleId } });
}

test('catalog: tenants list device types; adding an ESP32 returns a one-time key and setup text', async () => {
  const ku = await login('authority@ku.edu.bd');
  const types = await api(ku.token, 'GET', '/fleet/device-types');
  assert.strictEqual(types.status, 200);
  const codes = types.body.data.map((t) => t.code);
  for (const c of ['phone', 'esp32-json', 'osmand', 'traccar-gateway']) assert.ok(codes.includes(c), `missing ${c}`);

  const vehicle = await tempVehicle(ku);
  const dev = await newDevice(ku, vehicle.id, 'esp32-json');
  try {
    assert.match(dev.apiKey, /^fsk_/);
    assert.strictEqual(dev.reportingIntervalS, 30, 'interval defaults from the catalog');
    assert.ok(dev.setup.includes(dev.apiKey) && dev.setup.includes('/api/v1/ingest/json'));
    const listed = (await api(ku.token, 'GET', '/fleet/devices')).body.data.find((d) => d.id === dev.id);
    assert.strictEqual(listed.hasKey, true);
    assert.strictEqual(listed.apiKey, undefined, 'the key is never shown again');

    const traccar = await newDevice(ku, vehicle.id, 'traccar-gateway');
    assert.strictEqual(traccar.apiKey, null, 'gateway devices carry no key');
    await prisma.device.delete({ where: { id: traccar.id } });
  } finally { await cleanup([dev.id], vehicle.id); }
});

test('json ingest: key auth, storage, units, replay and ordering', async () => {
  const ku = await login('authority@ku.edu.bd');
  const vehicle = await tempVehicle(ku);
  const dev = await newDevice(ku, vehicle.id, 'esp32-json');
  try {
    assert.strictEqual((await raw('/ingest/json', { body: { lat: 22.8, lng: 89.5, ts: iso() } })).status, 401, 'no key');
    assert.strictEqual((await raw('/ingest/json', { key: 'fsk_wrong', body: { lat: 22.8, lng: 89.5, ts: iso() } })).status, 401, 'wrong key');
    assert.strictEqual((await raw('/ingest/json', { key: dev.apiKey, body: { imei: 'someone-else', lat: 22.8, lng: 89.5, ts: iso() } })).status, 401, 'id must match the key');

    // Bad data is rejected at the boundary.
    assert.strictEqual((await raw('/ingest/json', { key: dev.apiKey, body: { lat: 91, lng: 89.5, ts: iso() } })).status, 422, 'latitude range');
    const future = await raw('/ingest/json', { key: dev.apiKey, body: { lat: 22.8, lng: 89.5, ts: iso(-3600_000) } });
    assert.strictEqual(future.body.error.code, 'TIMESTAMP_IN_FUTURE');
    assert.strictEqual((await raw('/ingest/json', { key: dev.apiKey, body: { lat: 22.8, lng: 89.5 } })).status, 422, 'ts required');
    assert.strictEqual(await prisma.gpsLog.count({ where: { deviceId: dev.id } }), 0, 'rejected points store nothing');

    // A buffered batch arrives out of order, with a duplicate time; the newest wins the map.
    const t1 = iso(120_000), t2 = iso(60_000), t3 = iso(30_000);
    const batch = [
      { ts: t3, lat: 22.803, lng: 89.503, speed: 40, battery: 71, sos: true },
      { ts: t1, lat: 22.801, lng: 89.501, speed: 10, battery: 73 },
      { ts: t2, lat: 22.802, lng: 89.502, speed: 20, battery: 72 },
      { ts: t2, lat: 22.802, lng: 89.502, speed: 20, battery: 72 },
    ];
    const first = await raw('/ingest/json', { key: dev.apiKey, body: batch });
    assert.strictEqual(first.status, 200, JSON.stringify(first.body));
    assert.deepStrictEqual(first.body.data, { received: 3, stored: 3 });

    const again = await raw('/ingest/json', { key: dev.apiKey, body: batch });
    assert.deepStrictEqual(again.body.data, { received: 3, stored: 0 }, 'resending the buffer adds nothing');
    assert.strictEqual(await prisma.gpsLog.count({ where: { deviceId: dev.id } }), 3);

    const pos = (await api(ku.token, 'GET', '/fleet/positions')).body.data.find((p) => p.vehicleId === vehicle.id);
    assert.strictEqual(pos.lat, 22.803, 'latest position is the newest point');
    assert.strictEqual(pos.speed, 40, 'json speed is km/h, stored as sent');

    // An older point cannot rewind the map.
    await raw('/ingest/json', { key: dev.apiKey, body: { ts: iso(600_000), lat: 22.9, lng: 89.9 } });
    const after = (await api(ku.token, 'GET', '/fleet/positions')).body.data.find((p) => p.vehicleId === vehicle.id);
    assert.strictEqual(after.lat, 22.803);

    const row = (await api(ku.token, 'GET', '/fleet/devices')).body.data.find((d) => d.id === dev.id);
    assert.strictEqual(row.batteryPct, 71);
    assert.strictEqual(row.isOnline, true);
    // Not matched by time: gps_logs timestamps read back shifted by the DB session timezone.
    const flagged = await prisma.gpsLog.findMany({ where: { deviceId: dev.id, NOT: { attrs: { equals: Prisma.DbNull } } } });
    assert.deepStrictEqual(flagged.map((g) => g.attrs), [{ sos: true }]);

    // Rotating the key retires the old one.
    const rot = await api(ku.token, 'POST', `/fleet/devices/${dev.id}/rotate-key`);
    assert.strictEqual(rot.status, 200);
    assert.strictEqual((await raw('/ingest/json', { key: dev.apiKey, body: { ts: iso(), lat: 22.8, lng: 89.5 } })).status, 401);
    assert.strictEqual((await raw('/ingest/json', { key: rot.body.data.apiKey, body: { ts: iso(), lat: 22.8, lng: 89.5 } })).status, 200);

    // An inactive device is refused.
    await api(ku.token, 'PUT', `/fleet/devices/${dev.id}`, { status: 'inactive' });
    assert.strictEqual((await raw('/ingest/json', { key: rot.body.data.apiKey, body: { ts: iso(), lat: 22.8, lng: 89.5 } })).status, 403);
  } finally { await cleanup([dev.id], vehicle.id); }
});

test('osmand ingest converts knots to km/h and needs the key', async () => {
  const ku = await login('authority@ku.edu.bd');
  const vehicle = await tempVehicle(ku);
  const dev = await newDevice(ku, vehicle.id, 'osmand');
  try {
    const q = `id=${dev.imei}&lat=22.85&lon=89.54&timestamp=${Math.floor(Date.now() / 1000)}&speed=10&bearing=90&batt=55`;
    assert.strictEqual((await raw(`/ingest/osmand?${q}`, { method: 'GET' })).status, 401, 'no key');
    const ok = await raw(`/ingest/osmand?${q}&key=${dev.apiKey}`, { method: 'GET' });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    const log = await prisma.gpsLog.findFirst({ where: { deviceId: dev.id } });
    assert.ok(Math.abs(log.speed - 18.52) < 0.01, `10 knots is 18.52 km/h, got ${log.speed}`);
    assert.strictEqual(log.batteryPct, 55);
  } finally { await cleanup([dev.id], vehicle.id); }
});

test('tenant isolation: another tenant cannot read or write through a key it does not hold', async () => {
  const ku = await login('authority@ku.edu.bd');
  const apex = await login('authority@apex.com');
  const vehicle = await tempVehicle(ku);
  const dev = await newDevice(ku, vehicle.id, 'esp32-json');
  try {
    const stolen = (await api(apex.token, 'GET', '/fleet/devices')).body.data.find((d) => d.id === dev.id);
    assert.strictEqual(stolen, undefined, 'device list is tenant scoped');
    assert.strictEqual((await api(apex.token, 'POST', `/fleet/devices/${dev.id}/rotate-key`)).status, 404);
    // Apex cannot register a device onto a KU vehicle.
    const r = await api(apex.token, 'POST', '/fleet/devices', { vehicleId: vehicle.id, deviceType: 'esp32-json', imei: uniq() });
    assert.strictEqual(r.status, 422);
  } finally { await cleanup([dev.id], vehicle.id); }
});

test('traccar gateway: disabled without a secret, checks the secret, drops unknown devices', async () => {
  const ku = await login('authority@ku.edu.bd');
  const vehicle = await tempVehicle(ku);
  const dev = await newDevice(ku, vehicle.id, 'traccar-gateway');
  try {
    const body = { device: { uniqueId: dev.imei }, position: { latitude: 22.84, longitude: 89.52, speed: 5, course: 45, fixTime: iso(), attributes: { batteryLevel: 40, alarm: 'sos' } } };
    const noSecret = await raw('/ingest/traccar', { body });
    if (process.env.TRACCAR_FORWARD_SECRET) {
      assert.strictEqual(noSecret.status, 401);
      const h = { 'X-Forward-Secret': process.env.TRACCAR_FORWARD_SECRET };
      assert.strictEqual((await raw('/ingest/traccar', { body, headers: h })).status, 200);
      const unknown = await raw('/ingest/traccar', { body: { ...body, device: { uniqueId: 'nobody' } }, headers: h });
      assert.strictEqual(unknown.status, 404);
      const log = await prisma.gpsLog.findFirst({ where: { deviceId: dev.id } });
      assert.deepStrictEqual(log.attrs, { sos: true });
    } else {
      assert.strictEqual(noSecret.status, 503, 'gateway stays off until a secret is configured');
    }
  } finally { await cleanup([dev.id], vehicle.id); }
});
