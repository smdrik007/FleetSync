'use strict';
// Passenger status: next stop and approximate arrival from a real trip, in a throwaway vehicle institution.
const test = require('node:test');
const assert = require('node:assert');
const { api, login } = require('./helpers');
const prisma = require('../../src/db/client');

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let institutionId;

test.after(async () => {
  if (institutionId) await prisma.institution.delete({ where: { id: institutionId } }).catch(() => {});
  await prisma.$disconnect();
});

test('a passenger sees the next stop and an estimated time, which follow the bus', async () => {
  const n = stamp();
  const su = await api(null, 'POST', '/auth/signup', { institutionName: `Eta ${n}`, trackingType: 'vehicle', name: 'Owner', email: `owner.${n}@eta.test`, password: 'demo1234' });
  assert.strictEqual(su.status, 201, JSON.stringify(su.body));
  const A = su.body.data.token;
  institutionId = su.body.data.institution.id;

  // Three stops about 1.1 km apart, north to south of nothing in particular.
  const lat = [22.80, 22.81, 22.82];
  const stops = [];
  for (let i = 0; i < 3; i += 1) stops.push((await api(A, 'POST', '/fleet/stops', { name: `Stop ${'ABC'[i]}`, latitude: lat[i], longitude: 89.5 })).body.data);
  const route = (await api(A, 'POST', '/fleet/routes', { name: 'Line' })).body.data;
  assert.strictEqual((await api(A, 'PUT', `/fleet/routes/${route.id}/stops`, { stopIds: stops.map((s) => s.id) })).status, 200);

  const drvEmail = `drv.${n}@eta.test`;
  const drv = (await api(A, 'POST', '/fleet/drivers', { name: 'Drv', email: drvEmail, phone: `+8801${n.slice(-9)}`, password: 'demo1234', licenseNumber: `L-${n}` })).body.data;
  const model = (await api(A, 'POST', '/fleet/models', { make: 'M', model: 'Bus' })).body.data;
  const veh = (await api(A, 'POST', '/fleet/vehicles', { vehicleNumber: 'B1', plateNumber: `P-${n}`, modelId: model.id, assignedDriverId: drv.id, assignedRouteId: route.id })).body.data;
  const roles = (await api(A, 'GET', '/fleet/roles')).body.data;
  const paxEmail = `pax.${n}@eta.test`;
  assert.strictEqual((await api(A, 'POST', '/fleet/users', { name: 'Pax', email: paxEmail, password: 'demo1234', roleId: roles.find((r) => r.name === 'PASSENGER').id })).status, 201);

  const driver = await login(drvEmail, institutionId);
  const pax = await login(paxEmail, institutionId);
  const status = async () => (await api(pax.token, 'GET', `/passenger/vehicles/${veh.id}/status`)).body.data;

  assert.strictEqual((await status()).progress, null, 'no trip, no estimate');

  const trip = (await api(driver.token, 'POST', '/driver/trips/start')).body.data;
  const post = (latitude, ageMs) => api(driver.token, 'POST', `/driver/trips/${trip.tripId}/location`, { latitude, longitude: 89.5, timestamp: new Date(Date.now() - ageMs).toISOString() });
  // Moving north at about 33 km/h (555 m in 60 s), now between A and B.
  assert.strictEqual((await post(22.800, 60000)).status, 200);
  assert.strictEqual((await post(22.805, 1000)).status, 200);

  let p = (await status()).progress;
  assert.strictEqual(p.next.name, 'Stop B');
  assert.strictEqual(p.next.order, 2);
  assert.strictEqual(p.atStop, null);
  assert.strictEqual(p.speedMeasured, true);
  assert.ok(p.speedKmh >= 30 && p.speedKmh <= 36, `speed ${p.speedKmh}`);
  assert.ok(p.next.distanceM > 500 && p.next.distanceM < 900, `distance ${p.next.distanceM}`);
  assert.ok(p.next.etaMinutes >= 1 && p.next.etaMinutes <= 3, `eta ${p.next.etaMinutes}`);

  // The bus moves past B: the next stop becomes C.
  assert.strictEqual((await post(22.8115, 0)).status, 200);
  p = (await status()).progress;
  assert.strictEqual(p.next.name, 'Stop C');

  // Another institution's passenger cannot see this vehicle's status.
  const ku = await login('passenger@ku.edu.bd');
  assert.strictEqual((await api(ku.token, 'GET', `/passenger/vehicles/${veh.id}/status`)).status, 404);

  await api(driver.token, 'POST', `/driver/trips/${trip.tripId}/end`);
  assert.strictEqual((await status()).progress, null, 'trip ended, no estimate');
  await prisma.gpsLog.deleteMany({ where: { institutionId } });
});
