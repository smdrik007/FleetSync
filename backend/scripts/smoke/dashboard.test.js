'use strict';
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { login, api, ensureEmptyTenant, WS_URL } = require('./helpers');
const prisma = require('../../src/db/client');

let ku, apex, empty, driver;
test.before(async () => {
  ku = await login('authority@ku.edu.bd');
  apex = await login('authority@apex.com');
  empty = await ensureEmptyTenant();
  driver = await login('rahim@ku.edu.bd');
});
test.after(async () => { await prisma.$disconnect(); });

const summary = async (s) => (await api(s.token, 'GET', '/fleet/dashboard/summary')).body.data;

test('dashboard: status counts add up to the vehicle list', async () => {
  const s = await summary(ku);
  const vehicles = (await api(ku.token, 'GET', '/fleet/vehicles')).body.data;
  assert.strictEqual(s.totalVehicles, vehicles.length);
  const sum = Object.values(s.vehiclesByStatus).reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, s.totalVehicles);
  assert.deepStrictEqual(Object.keys(s.vehiclesByStatus).sort(), ['idle', 'maintenance', 'offline', 'on_trip', 'retired']);
  assert.ok(s.activeTrips >= 1);
});

test('dashboard: time series are zero-filled and ordered oldest first', async () => {
  const s = await summary(ku);
  assert.strictEqual(s.tripsPerDay.length, 14);
  assert.strictEqual(s.fuelCostPerWeek.length, 8);
  assert.strictEqual(s.maintenanceCostByMonth.length, 6);
  const days = s.tripsPerDay.map((d) => d.date);
  assert.deepStrictEqual(days, [...days].sort());
  assert.ok(new Set(days).size === 14, 'distinct days');
  assert.ok(s.tripsPerDay.reduce((a, d) => a + d.count, 0) >= 5, 'seeded trips appear in the series');
  assert.ok(s.fuelCostPerWeek.some((w) => w.cost > 0));
});

test('dashboard: lists upcoming maintenance and license expiries', async () => {
  const s = await summary(ku);
  assert.ok(s.upcomingMaintenance.length >= 1 && s.upcomingMaintenance.length <= 5);
  assert.ok(s.upcomingMaintenance[0].vehicleNumber);
  assert.ok(s.licenseExpiring.some((d) => d.name === 'Rahim Uddin'));
  assert.ok(s.fuelCost30d > 0);
  assert.strictEqual(typeof s.devices.online, 'number');
});

test('dashboard: figures are tenant-scoped', async () => {
  const a = await summary(apex);
  const k = await summary(ku);
  assert.notDeepStrictEqual(a.tripsPerDay, k.tripsPerDay.map((d) => ({ ...d, count: -1 })));
  assert.ok(!a.upcomingMaintenance.some((m) => k.upcomingMaintenance.some((x) => x.id === m.id)));
  assert.ok(!a.licenseExpiring.some((d) => k.licenseExpiring.some((x) => x.driverId === d.driverId)));
});

test('dashboard: an empty tenant returns zeros and empty lists (200)', async () => {
  const r = await api(empty.token, 'GET', '/fleet/dashboard/summary');
  assert.strictEqual(r.status, 200);
  const s = r.body.data;
  assert.strictEqual(s.totalVehicles, 0);
  assert.strictEqual(s.activeTrips, 0);
  assert.strictEqual(s.fuelCost30d, 0);
  assert.deepStrictEqual(s.upcomingMaintenance, []);
  assert.deepStrictEqual(s.licenseExpiring, []);
  assert.strictEqual(s.tripsPerDay.length, 14);
  assert.ok(s.tripsPerDay.every((d) => d.count === 0));
});

test('dashboard: non-authority users are forbidden (403)', async () => {
  assert.strictEqual((await api(driver.token, 'GET', '/fleet/dashboard/summary')).status, 403);
});

test('dashboard: starting a trip broadcasts trip.started to the institution', async () => {
  // Use whichever KU driver is free (a demo trip may already be running); never touch an existing trip.
  const candidates = [await login('rahim@ku.edu.bd'), await login('karim@ku.edu.bd')];
  const ws = new WebSocket(`${WS_URL}?token=${ku.token}`);
  let tripId; // from the HTTP response
  let startedId; // from the broadcast (can arrive first)
  try {
    const got = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no trip.started within 4s')), 4000);
      ws.on('message', async (raw) => {
        const msg = JSON.parse(raw);
        if (msg.event === 'connected') {
          let last;
          for (const d of candidates) {
            last = await api(d.token, 'POST', '/driver/trips/start');
            if (last.status === 201) { tripId = last.body.data.tripId; return; }
          }
          clearTimeout(timer);
          reject(new Error(`no free driver to start a trip: ${last.status} ${JSON.stringify(last.body)}`));
        }
        if (msg.event === 'trip.started') { startedId = msg.data.tripId; clearTimeout(timer); resolve(msg.data); }
      });
      ws.on('error', reject);
    });
    const data = await got;
    assert.ok(data.tripId && data.vehicleId && data.vehicleNumber && data.startedAt);
    assert.strictEqual(data.institutionId, ku.institutionId);
  } finally {
    ws.close();
    // Leave the demo data as we found it: no extra empty trip, vehicle back to idle.
    const createdId = tripId || startedId;
    if (createdId) {
      const t = await prisma.trip.findUnique({ where: { id: createdId } });
      await prisma.trip.deleteMany({ where: { id: createdId } });
      if (t) await prisma.vehicle.update({ where: { id: t.vehicleId }, data: { currentStatus: 'idle' } });
    }
  }
});
