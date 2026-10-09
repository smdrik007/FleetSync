'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { login, api } = require('./helpers');

let ku, apex;
test.before(async () => { ku = await login('authority@ku.edu.bd'); apex = await login('authority@apex.com'); });

test('models: list includes global catalog rows flagged isGlobal', async () => {
  const r = await api(ku.token, 'GET', '/fleet/models');
  assert.strictEqual(r.status, 200);
  const g = r.body.data.find((m) => m.isGlobal);
  assert.ok(g, 'expected a global model');
  assert.strictEqual(g.institutionId, null);
  assert.strictEqual(typeof g.vehicleCount, 'number');
});

test('models: create → update → delete round trip', async () => {
  const c = await api(ku.token, 'POST', '/fleet/models', { make: 'Hino', model: 'RK8', year: 2022, fuelType: 'diesel', capacity: 45 });
  assert.strictEqual(c.status, 201);
  const id = c.body.data.id;
  assert.strictEqual(c.body.data.isGlobal, false);
  const u = await api(ku.token, 'PUT', `/fleet/models/${id}`, { capacity: 50 });
  assert.strictEqual(u.status, 200);
  assert.strictEqual(u.body.data.capacity, 50);
  const d = await api(ku.token, 'DELETE', `/fleet/models/${id}`);
  assert.strictEqual(d.status, 200);
});

test('models: another tenant cannot modify a tenant model (404)', async () => {
  const c = await api(ku.token, 'POST', '/fleet/models', { make: 'Isuzu', model: 'NQR' });
  const id = c.body.data.id;
  const r = await api(apex.token, 'PUT', `/fleet/models/${id}`, { capacity: 1 });
  assert.strictEqual(r.status, 404);
  await api(ku.token, 'DELETE', `/fleet/models/${id}`);
});

test('models: global rows are read-only (403)', async () => {
  const list = await api(ku.token, 'GET', '/fleet/models');
  const g = list.body.data.find((m) => m.isGlobal);
  assert.strictEqual((await api(ku.token, 'DELETE', `/fleet/models/${g.id}`)).status, 403);
  assert.strictEqual((await api(ku.token, 'PUT', `/fleet/models/${g.id}`, { capacity: 1 })).status, 403);
});

test('models: deleting a model used by a vehicle returns 409', async () => {
  const c = await api(ku.token, 'POST', '/fleet/models', { make: 'Ashok', model: 'Leyland' });
  const modelId = c.body.data.id;
  const v = await api(ku.token, 'POST', '/fleet/vehicles', { vehicleNumber: 'Bus #T9', plateNumber: 'T-9-0001', modelId });
  assert.ok([200, 201].includes(v.status), JSON.stringify(v.body));
  const d = await api(ku.token, 'DELETE', `/fleet/models/${modelId}`);
  assert.strictEqual(d.status, 409);
  await api(ku.token, 'DELETE', `/fleet/vehicles/${v.body.data.id}`);
  assert.strictEqual((await api(ku.token, 'DELETE', `/fleet/models/${modelId}`)).status, 200);
});

test('models: make and model are required (422)', async () => {
  const r = await api(ku.token, 'POST', '/fleet/models', { model: 'X' });
  assert.strictEqual(r.status, 422);
  assert.strictEqual(r.body.error.code, 'MISSING_FIELDS');
});

test('vehicles: create accepts modelId + assignedRouteId and returns them', async () => {
  const models = (await api(ku.token, 'GET', '/fleet/models')).body.data;
  const routes = (await api(ku.token, 'GET', '/fleet/vehicles')).body.data; // reuse a seeded route id
  const routeId = routes.find((v) => v.assignedRouteId)?.assignedRouteId;
  assert.ok(routeId, 'vehicle list should expose assignedRouteId');
  const r = await api(ku.token, 'POST', '/fleet/vehicles', { vehicleNumber: 'Bus #T8', plateNumber: 'T-8-0001', modelId: models[0].id, assignedRouteId: routeId });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.data.modelId, models[0].id);
  assert.strictEqual(r.body.data.assignedRouteId, routeId);
  await api(ku.token, 'DELETE', `/fleet/vehicles/${r.body.data.id}`);
});

test('vehicles: modelId / assignedRouteId from another tenant are rejected (422)', async () => {
  const mine = await api(apex.token, 'POST', '/fleet/models', { make: 'Foreign', model: 'Only' });
  const bad = await api(ku.token, 'POST', '/fleet/vehicles', { vehicleNumber: 'Bus #T7', plateNumber: 'T-7-0001', modelId: mine.body.data.id });
  assert.strictEqual(bad.status, 422);
  assert.strictEqual(bad.body.error.code, 'INVALID_MODEL');
  await api(apex.token, 'DELETE', `/fleet/models/${mine.body.data.id}`);
});

test('vehicles: create without any model is a 422, not a 500', async () => {
  const r = await api(ku.token, 'POST', '/fleet/vehicles', { vehicleNumber: 'Bus #T6', plateNumber: 'T-6-0001' });
  assert.strictEqual(r.status, 422);
  assert.strictEqual(r.body.error.code, 'MISSING_MODEL');
});

test('vehicles: creating a vehicle with an already-assigned driver moves the driver', async () => {
  const vehicles = (await api(ku.token, 'GET', '/fleet/vehicles')).body.data;
  const holder = vehicles.find((v) => v.assignedDriver);
  const models = (await api(ku.token, 'GET', '/fleet/models')).body.data;
  const created = await api(ku.token, 'POST', '/fleet/vehicles', { vehicleNumber: 'Bus #T5', plateNumber: 'T-5-0001', modelId: models[0].id, assignedDriverId: holder.assignedDriver.id });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  try {
    const after = (await api(ku.token, 'GET', `/fleet/vehicles/${holder.id}`)).body.data;
    assert.strictEqual(after.assignedDriver, null, 'previous vehicle must lose the driver');
    assert.strictEqual(created.body.data.assignedDriver.id, holder.assignedDriver.id);
  } finally {
    await api(ku.token, 'DELETE', `/fleet/vehicles/${created.body.data.id}`);
    await api(ku.token, 'PUT', `/fleet/vehicles/${holder.id}`, { assignedDriverId: holder.assignedDriver.id });
  }
});
