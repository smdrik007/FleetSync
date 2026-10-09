'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { login, api, ensureEmptyTenant } = require('./helpers');

let driver, passenger, empty;
test.before(async () => {
  driver = await login('rahim@ku.edu.bd');
  passenger = await login('passenger@ku.edu.bd');
  empty = await ensureEmptyTenant();
});

test('driver app: assignment carries the ordered route stops', async () => {
  const r = await api(driver.token, 'GET', '/driver/me/assignment');
  assert.strictEqual(r.status, 200);
  const stops = r.body.data.vehicle.routeStops;
  assert.deepStrictEqual(stops.map((s) => s.name), ['Sonadanga', 'Shibbari', 'KU Main Gate', 'KU Campus']);
  assert.deepStrictEqual(stops.map((s) => s.stopOrder), [1, 2, 3, 4]);
  assert.strictEqual(typeof stops[0].latitude, 'number');
});

test('driver app: an active trip reports its status in the lowercase schema form', async () => {
  const r = await api(driver.token, 'GET', '/driver/me/assignment');
  assert.strictEqual(r.body.data.activeTrip.status, 'in_progress');
});

test('passenger app: vehicles list carries route stops and the live position', async () => {
  const r = await api(passenger.token, 'GET', '/passenger/vehicles');
  assert.strictEqual(r.status, 200);
  const withRoute = r.body.data.find((v) => v.assignedRoute);
  assert.ok(Array.isArray(withRoute.routeStops) && withRoute.routeStops.length >= 3);
  const live = r.body.data.find((v) => v.currentStatus === 'on_trip');
  assert.ok(live.lastKnownPosition, 'an on-trip vehicle must expose lastKnownPosition');
  assert.strictEqual(typeof live.lastKnownPosition.latitude, 'number');
});

test('passenger app: single vehicle status carries route stops', async () => {
  const list = (await api(passenger.token, 'GET', '/passenger/vehicles')).body.data;
  const v = list.find((x) => x.assignedRoute);
  const r = await api(passenger.token, 'GET', `/passenger/vehicles/${v.id}/status`);
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.data.routeStops.length >= 3);
});

test('passenger app: an institution with no vehicles gets an empty list, not a 500', async () => {
  const p = await login('passenger@empty.test', empty.institutionId);
  const r = await api(p.token, 'GET', '/passenger/vehicles');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.data, []);
});

test('driver app: assignment exposes the driver record id (for matching reassignment events)', async () => {
  const r = await api(driver.token, 'GET', '/driver/me/assignment');
  const drivers = (await api((await login('authority@ku.edu.bd')).token, 'GET', '/fleet/drivers')).body.data;
  const rahim = drivers.find((d) => d.email === 'rahim@ku.edu.bd');
  assert.strictEqual(r.body.data.driverId, rahim.id);
});
