'use strict';
// Vehicle GPS retention: old points go, running trips and trip summaries stay, each institution keeps its own window.
const test = require('node:test');
const assert = require('node:assert');
const { api, login } = require('./helpers');
const prisma = require('../../src/db/client');
const { purgeOldPoints } = require('../../src/lib/alerts');

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const DAY = 86400_000;
const created = [];

test.after(async () => {
  for (const id of created) {
    await prisma.gpsLog.deleteMany({ where: { institutionId: id } });
    await prisma.institution.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect();
});

/** A vehicle institution with one driver on one bus; returns tokens and ids. */
async function fleet() {
  const n = stamp();
  const su = await api(null, 'POST', '/auth/signup', { institutionName: `Ret ${n}`, trackingType: 'vehicle', name: 'Owner', email: `owner.${n}@ret.test`, password: 'demo1234' });
  assert.strictEqual(su.status, 201, JSON.stringify(su.body));
  const A = su.body.data.token;
  const institutionId = su.body.data.institution.id;
  created.push(institutionId);
  const drvEmail = `drv.${n}@ret.test`;
  const drv = (await api(A, 'POST', '/fleet/drivers', { name: 'Drv', email: drvEmail, phone: `+8801${n.slice(-9)}`, password: 'demo1234', licenseNumber: `L-${n}` })).body.data;
  const model = (await api(A, 'POST', '/fleet/models', { make: 'M', model: 'Bus' })).body.data;
  await api(A, 'POST', '/fleet/vehicles', { vehicleNumber: 'B1', plateNumber: `P-${n}`, modelId: model.id, assignedDriverId: drv.id });
  return { A, institutionId, driver: await login(drvEmail, institutionId) };
}

/** One trip with a point `ageDays` old and one fresh point, optionally left running. */
async function trip(driver, ageDays, { end = true } = {}) {
  const t = (await api(driver.token, 'POST', '/driver/trips/start')).body.data;
  for (const [lat, ago] of [[22.80, ageDays * DAY], [22.81, ageDays * DAY - 60_000]]) {
    const r = await api(driver.token, 'POST', `/driver/trips/${t.tripId}/location`, { latitude: lat, longitude: 89.5, timestamp: new Date(Date.now() - ago).toISOString() });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  }
  if (end) await api(driver.token, 'POST', `/driver/trips/${t.tripId}/end`);
  return t.tripId;
}

const points = (tripId) => prisma.gpsLog.count({ where: { tripId } });

test('new sign-ups keep 7 days; the setting accepts only 1, 7, 30 or 90', async () => {
  const f = await fleet();
  assert.strictEqual((await api(f.A, 'GET', '/fleet/institution')).body.data.gpsRetentionDays, 7);
  for (const bad of [0, 2, 365, 'x']) {
    const r = await api(f.A, 'PUT', '/fleet/institution', { gpsRetentionDays: bad });
    assert.strictEqual(r.status, 422, String(bad));
    assert.strictEqual(r.body.error.code, 'INVALID_GPSRETENTIONDAYS');
  }
  assert.strictEqual((await api(f.A, 'PUT', '/fleet/institution', { gpsRetentionDays: 1 })).body.data.gpsRetentionDays, 1);
});

test('old points are deleted, the trip summary stays, and a running trip is never cut', async () => {
  const short = await fleet();
  await api(short.A, 'PUT', '/fleet/institution', { gpsRetentionDays: 1 });
  const old = await trip(short.driver, 3);            // finished, 3 days old
  const before = await prisma.trip.findUnique({ where: { id: old } });
  assert.ok(Number(before.distanceKm) > 1, 'distance saved at trip end');

  const long = await fleet();                         // keeps 7 days (default)
  const kept = await trip(long.driver, 3);

  const running = await trip(short.driver, 3, { end: false });   // started 3 days ago, still going

  await purgeOldPoints();

  assert.strictEqual(await points(old), 0, '1-day institution: 3-day-old points are gone');
  const after = await prisma.trip.findUnique({ where: { id: old } });
  assert.strictEqual(Number(after.distanceKm), Number(before.distanceKm), 'trip summary unchanged');
  assert.strictEqual(after.status, 'completed');
  assert.strictEqual(await points(kept), 2, '7-day institution keeps 3-day-old points');
  assert.strictEqual(await points(running), 2, 'a trip in progress keeps every point');

  // Once that trip ends, its old points go on the next run, after its distance is saved.
  await api(short.driver.token, 'POST', `/driver/trips/${running}/end`);
  await purgeOldPoints();
  assert.strictEqual(await points(running), 0);
  assert.ok(Number((await prisma.trip.findUnique({ where: { id: running } })).distanceKm) > 1);
});

test('a finished trip with no saved distance gets it computed before its points go', async () => {
  const f = await fleet();
  await api(f.A, 'PUT', '/fleet/institution', { gpsRetentionDays: 1 });
  const id = await trip(f.driver, 3);
  await prisma.trip.update({ where: { id }, data: { distanceKm: null } });   // as for trips ended before distances existed
  await purgeOldPoints();
  const t = await prisma.trip.findUnique({ where: { id } });
  assert.ok(Number(t.distanceKm) > 1, `distance backfilled, got ${t.distanceKm}`);
  assert.strictEqual(await points(id), 0);
});
