'use strict';
// Trip distance + fuel estimate, vehicle efficiency validation, and the tenant cost totals.
const test = require('node:test');
const assert = require('node:assert');
const { login, api, ensureEmptyTenant } = require('./helpers');
const prisma = require('../../src/db/client');

test.after(async () => { await prisma.$disconnect(); });

const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} not within ${tol} of ${expected}`);

test('distance: sums segments, ignores GPS jitter and impossible jumps, drives the fuel estimate', async () => {
  const ku = await login('authority@ku.edu.bd');
  const n = `${Date.now()}`;
  const email = `dist.${n}@ku.edu.bd`;
  const drv = await api(ku.token, 'POST', '/fleet/drivers', { name: `Dist Test ${n}`, email, phone: `+8801${n.slice(-9)}`, password: 'demo1234', licenseNumber: `DT-${n}` });
  assert.strictEqual(drv.status, 201, JSON.stringify(drv.body));
  let vehicleId;
  try {
    // A global catalog model: the catalog tests create and delete tenant models while this runs.
    const model = (await api(ku.token, 'GET', '/fleet/models')).body.data.find((m) => m.isGlobal);
    const veh = await api(ku.token, 'POST', '/fleet/vehicles', { vehicleNumber: `DT-${n.slice(-6)}`, plateNumber: `DT-${n}`, modelId: model.id, assignedDriverId: drv.body.data.id });
    assert.strictEqual(veh.status, 201, JSON.stringify(veh.body));
    vehicleId = veh.body.data.id;
    assert.strictEqual(veh.body.data.fuelEfficiencyKmpl, null);

    // Efficiency must be a sane positive number.
    for (const bad of [-1, 0, 'abc', 101]) {
      const r = await api(ku.token, 'PUT', `/fleet/vehicles/${vehicleId}`, { fuelEfficiencyKmpl: bad });
      assert.strictEqual(r.status, 422, `fuelEfficiencyKmpl ${bad} must be rejected`);
    }

    const session = await login(email);
    const start = await api(session.token, 'POST', '/driver/trips/start');
    assert.strictEqual(start.status, 201, JSON.stringify(start.body));
    const tripId = start.body.data.tripId;

    // 0.01 degree of latitude is ~1.112 km. Timestamps are far enough apart to be a plausible speed.
    const t0 = Date.now() - 30 * 60000;
    const fix = (lat, secs) => api(session.token, 'POST', `/driver/trips/${tripId}/location`, { latitude: lat, longitude: 89.52, timestamp: new Date(t0 + secs * 1000).toISOString() });
    for (const [lat, secs] of [[22.86, 0], [22.87, 60], [22.87001, 65], [23.5, 70]]) {
      assert.strictEqual((await fix(lat, secs)).status, 200); // 22.87001 is ~1 m of jitter, 23.5 is a 70 km jump in 5 s
    }

    // While the trip runs, the detail measures live.
    const live = await api(ku.token, 'GET', `/fleet/trips/${tripId}`);
    near(live.body.data.distanceKm, 1.112, 0.02, 'live distance');

    const end = await api(session.token, 'POST', `/driver/trips/${tripId}/end`);
    assert.strictEqual(end.status, 200, JSON.stringify(end.body));
    near(end.body.data.distanceKm, 1.112, 0.02, 'distance in the /end response');

    // No efficiency yet: estimates are null, never zero.
    let d = (await api(ku.token, 'GET', `/fleet/trips/${tripId}`)).body.data;
    near(d.distanceKm, 1.112, 0.02, 'stored distance');
    assert.strictEqual(d.estFuelLitres, null);
    assert.strictEqual(d.estFuelCost, null);

    const set = await api(ku.token, 'PUT', `/fleet/vehicles/${vehicleId}`, { fuelEfficiencyKmpl: 4 });
    assert.strictEqual(set.status, 200, JSON.stringify(set.body));
    assert.strictEqual(set.body.data.fuelEfficiencyKmpl, 4);

    d = (await api(ku.token, 'GET', `/fleet/trips/${tripId}`)).body.data;
    near(d.estFuelLitres, d.distanceKm / 4, 0.01, 'estimated litres');
    const fuel = (await api(ku.token, 'GET', '/fleet/fuel')).body.data;
    const litres = fuel.reduce((a, f) => a + f.volume, 0);
    assert.ok(litres > 0, 'seed has fuel logs for the price');
    near(d.estFuelCost, (d.distanceKm / 4) * (fuel.reduce((a, f) => a + f.totalCost, 0) / litres), 0.05, 'estimated cost');

    // The list carries the same numbers.
    const row = (await api(ku.token, 'GET', `/fleet/trips?vehicleId=${vehicleId}`)).body.data.find((t) => t.id === tripId);
    assert.strictEqual(row.distanceKm, d.distanceKm);
    assert.strictEqual(row.estFuelLitres, d.estFuelLitres);

    // Clearing the efficiency clears the estimate again.
    await api(ku.token, 'PUT', `/fleet/vehicles/${vehicleId}`, { fuelEfficiencyKmpl: null });
    assert.strictEqual((await api(ku.token, 'GET', `/fleet/trips/${tripId}`)).body.data.estFuelLitres, null);

    // Another tenant cannot read this trip.
    const apex = await login('authority@apex.com');
    assert.strictEqual((await api(apex.token, 'GET', `/fleet/trips/${tripId}`)).status, 404);
  } finally {
    if (vehicleId) {
      await prisma.gpsLog.deleteMany({ where: { vehicleId } });
      await prisma.vehicleLatestPosition.deleteMany({ where: { vehicleId } });
      await prisma.trip.deleteMany({ where: { vehicleId } });
      await prisma.device.deleteMany({ where: { vehicleId } });
      await prisma.vehicle.delete({ where: { id: vehicleId } });
    }
    await prisma.driver.delete({ where: { id: drv.body.data.id } });
    await prisma.userRole.deleteMany({ where: { userId: drv.body.data.userId } });
    await prisma.user.delete({ where: { id: drv.body.data.userId } });
  }
});

test('costs: totals are fuel + maintenance (no cancelled, no null cost) and tenant-scoped', async () => {
  const ku = await login('authority@ku.edu.bd');
  // Other smoke files add fuel/maintenance rows to the same demo data while this runs, so compare snapshots
  // taken together and filter a vehicle in the same round trip.
  const probe = (await api(ku.token, 'GET', '/fleet/costs')).body.data.byVehicle.find((x) => x.fuelCost > 0);
  const [costs, fuel, maint, oneRes] = await Promise.all([
    api(ku.token, 'GET', '/fleet/costs'), api(ku.token, 'GET', '/fleet/fuel'), api(ku.token, 'GET', '/fleet/maintenance'),
    api(ku.token, 'GET', `/fleet/costs?vehicleId=${probe.vehicleId}`),
  ]);
  assert.strictEqual(costs.status, 200, JSON.stringify(costs.body));
  const c = costs.body.data;
  const fuelSum = fuel.body.data.reduce((a, f) => a + f.totalCost, 0);
  const maintSum = maint.body.data.filter((m) => m.status !== 'cancelled' && m.cost !== null).reduce((a, m) => a + m.cost, 0);
  near(c.totals.fuel, fuelSum, 0.05, 'fuel total');
  near(c.totals.maintenance, maintSum, 0.05, 'maintenance total');
  near(c.totals.total, c.totals.fuel + c.totals.maintenance, 0.011, 'total = fuel + maintenance');
  near(c.byVehicle.reduce((a, v) => a + v.total, 0), c.totals.total, 0.05, 'vehicle rows add up');
  near(c.byMonth.reduce((a, m) => a + m.total, 0), c.totals.total, 0.05, 'month rows add up');
  assert.ok(c.distanceKm > 0, 'seeded completed trips have distance');
  assert.ok(c.costPerKm > 0);

  // One vehicle only.
  const v = c.byVehicle.find((x) => x.vehicleId === probe.vehicleId);
  const one = oneRes.body.data;
  assert.strictEqual(one.byVehicle.length, 1);
  near(one.totals.total, v.total, 0.011, 'vehicle filter');

  // A range with nothing in it is all zeros, not an error.
  const none = (await api(ku.token, 'GET', '/fleet/costs?from=2099-01-01&to=2099-12-31')).body.data;
  assert.deepStrictEqual(none.totals, { fuel: 0, maintenance: 0, total: 0 });
  assert.deepStrictEqual(none.byMonth, []);
  assert.strictEqual(none.costPerKm, null);
});

test('costs: validation, roles and an empty tenant', async () => {
  const ku = await login('authority@ku.edu.bd');
  assert.strictEqual((await api(ku.token, 'GET', '/fleet/costs?from=nope')).status, 422);
  const badVehicle = await api(ku.token, 'GET', '/fleet/costs?vehicleId=not-a-uuid');
  assert.strictEqual(badVehicle.status, 200);
  assert.strictEqual(badVehicle.body.data.totals.total, 0);
  assert.strictEqual((await api(null, 'GET', '/fleet/costs')).status, 401);
  const driver = await login('rahim@ku.edu.bd');
  assert.strictEqual((await api(driver.token, 'GET', '/fleet/costs')).status, 403);

  const empty = await ensureEmptyTenant();
  const r = await api(empty.token, 'GET', '/fleet/costs');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.data, { totals: { fuel: 0, maintenance: 0, total: 0 }, distanceKm: 0, costPerKm: null, byVehicle: [], byMonth: [] });
});
