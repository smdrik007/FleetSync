'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { login, api } = require('./helpers');

let ku, apex;
test.before(async () => { ku = await login('authority@ku.edu.bd'); apex = await login('authority@apex.com'); });

const mkStop = async (t, name, latitude = 22.8, longitude = 89.5) => (await api(t.token, 'POST', '/fleet/stops', { name, latitude, longitude })).body.data;
const uniq = (p) => `${p} ${Date.now()}${Math.floor(Math.random() * 1000)}`;

test('network: seeded routes list stopCount and vehicleCount', async () => {
  const r = await api(ku.token, 'GET', '/fleet/routes');
  assert.strictEqual(r.status, 200);
  const seeded = r.body.data.find((x) => x.stopCount >= 3);
  assert.ok(seeded, 'a seeded route with stops');
  assert.strictEqual(typeof seeded.vehicleCount, 'number');
});

test('network: PUT /routes/:id/stops stores 1-based order and replaces the list', async () => {
  const route = (await api(ku.token, 'POST', '/fleet/routes', { name: uniq('R') })).body.data;
  const [s1, s2, s3] = [await mkStop(ku, uniq('s1')), await mkStop(ku, uniq('s2')), await mkStop(ku, uniq('s3'))];
  const a = await api(ku.token, 'PUT', `/fleet/routes/${route.id}/stops`, { stopIds: [s3.id, s1.id, s2.id] });
  assert.strictEqual(a.status, 200);
  assert.deepStrictEqual(a.body.data.stops.map((s) => s.stopId), [s3.id, s1.id, s2.id]);
  assert.deepStrictEqual(a.body.data.stops.map((s) => s.stopOrder), [1, 2, 3]);
  const b = await api(ku.token, 'PUT', `/fleet/routes/${route.id}/stops`, { stopIds: [s2.id] });
  assert.strictEqual(b.body.data.stops.length, 1);
  const g = await api(ku.token, 'GET', `/fleet/routes/${route.id}`);
  assert.strictEqual(g.body.data.stopCount, 1);
  await api(ku.token, 'DELETE', `/fleet/routes/${route.id}`);
  for (const s of [s1, s2, s3]) await api(ku.token, 'DELETE', `/fleet/stops/${s.id}`);
});

test('network: invalid stopIds are rejected with 422 INVALID_STOPS', async () => {
  const route = (await api(ku.token, 'POST', '/fleet/routes', { name: uniq('R') })).body.data;
  const s = await mkStop(ku, uniq('s'));
  const foreign = await mkStop(apex, uniq('foreign'));
  const cases = {
    empty: [], duplicate: [s.id, s.id], unknown: ['00000000-0000-4000-9999-000000000000'], foreignTenant: [foreign.id],
  };
  for (const [name, stopIds] of Object.entries(cases)) {
    const r = await api(ku.token, 'PUT', `/fleet/routes/${route.id}/stops`, { stopIds });
    assert.strictEqual(r.status, 422, name);
    assert.strictEqual(r.body.error.code, 'INVALID_STOPS', name);
  }
  await api(ku.token, 'DELETE', `/fleet/routes/${route.id}`);
  await api(ku.token, 'DELETE', `/fleet/stops/${s.id}`);
  await api(apex.token, 'DELETE', `/fleet/stops/${foreign.id}`);
});

test('network: deleting a stop used by a route returns 409', async () => {
  const route = (await api(ku.token, 'POST', '/fleet/routes', { name: uniq('R') })).body.data;
  const s = await mkStop(ku, uniq('s'));
  await api(ku.token, 'PUT', `/fleet/routes/${route.id}/stops`, { stopIds: [s.id] });
  assert.strictEqual((await api(ku.token, 'DELETE', `/fleet/stops/${s.id}`)).status, 409);
  await api(ku.token, 'DELETE', `/fleet/routes/${route.id}`);
  assert.strictEqual((await api(ku.token, 'DELETE', `/fleet/stops/${s.id}`)).status, 200);
});

test('network: duplicate route name in a tenant returns 409, same name in another tenant is fine', async () => {
  const name = uniq('Dup');
  const a = await api(ku.token, 'POST', '/fleet/routes', { name });
  assert.strictEqual(a.status, 201);
  assert.strictEqual((await api(ku.token, 'POST', '/fleet/routes', { name })).status, 409);
  const other = await api(apex.token, 'POST', '/fleet/routes', { name });
  assert.strictEqual(other.status, 201);
  await api(ku.token, 'DELETE', `/fleet/routes/${a.body.data.id}`);
  await api(apex.token, 'DELETE', `/fleet/routes/${other.body.data.id}`);
});

test('network: latitude/longitude are range-checked (422)', async () => {
  assert.strictEqual((await api(ku.token, 'POST', '/fleet/stops', { name: 'X', latitude: 91, longitude: 0 })).status, 422);
  assert.strictEqual((await api(ku.token, 'POST', '/fleet/stops', { name: 'X', latitude: 0, longitude: -181 })).status, 422);
  assert.strictEqual((await api(ku.token, 'POST', '/fleet/stops', { name: 'X', latitude: 'abc', longitude: 0 })).status, 422);
});

test('network: another tenant cannot read or edit a route or stop (404)', async () => {
  const list = (await api(ku.token, 'GET', '/fleet/routes')).body.data;
  assert.strictEqual((await api(apex.token, 'GET', `/fleet/routes/${list[0].id}`)).status, 404);
  assert.strictEqual((await api(apex.token, 'PUT', `/fleet/routes/${list[0].id}`, { description: 'x' })).status, 404);
  const stops = (await api(ku.token, 'GET', '/fleet/stops')).body.data;
  assert.strictEqual((await api(apex.token, 'PUT', `/fleet/stops/${stops[0].id}`, { name: 'hijack' })).status, 404);
  assert.strictEqual((await api(apex.token, 'DELETE', `/fleet/stops/${stops[0].id}`)).status, 404);
});

test('network: deleting a route unassigns its vehicles instead of failing', async () => {
  const route = (await api(ku.token, 'POST', '/fleet/routes', { name: uniq('R') })).body.data;
  const models = (await api(ku.token, 'GET', '/fleet/models')).body.data;
  const v = (await api(ku.token, 'POST', '/fleet/vehicles', { vehicleNumber: uniq('Bus #N'), plateNumber: uniq('N'), modelId: models[0].id, assignedRouteId: route.id })).body.data;
  assert.strictEqual((await api(ku.token, 'DELETE', `/fleet/routes/${route.id}`)).status, 200);
  const after = (await api(ku.token, 'GET', `/fleet/vehicles/${v.id}`)).body.data;
  assert.strictEqual(after.assignedRouteId, null);
  await api(ku.token, 'DELETE', `/fleet/vehicles/${v.id}`);
});
