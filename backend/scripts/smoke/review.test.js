'use strict';
// Regression tests for the final whole-branch review findings.
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { login, api, WS_URL } = require('./helpers');

let ku, apex, passenger, driver;
test.before(async () => {
  ku = await login('authority@ku.edu.bd'); apex = await login('authority@apex.com');
  passenger = await login('passenger@ku.edu.bd'); driver = await login('rahim@ku.edu.bd');
});

/** Open a socket; collect every message; resolves once connected. */
function openSocket(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?token=${token}`);
    const events = [];
    ws.on('message', (raw) => { const m = JSON.parse(raw); events.push(m); if (m.event === 'connected') resolve({ ws, events }); });
    ws.on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LEAK = /prisma|node_modules|invalid .*invocation|[A-Za-z]:\\|\.js:\d+/i;

test('review #1: a passenger cannot watch another tenant\'s vehicle over WebSocket', async () => {
  const apexVehicle = (await api(apex.token, 'GET', '/fleet/vehicles')).body.data[0];
  const kuVehicle = (await api(ku.token, 'GET', '/fleet/vehicles')).body.data[0];
  const { ws, events } = await openSocket(passenger.token);
  try {
    ws.send(JSON.stringify({ action: 'watch_vehicle', vehicleId: apexVehicle.id }));
    ws.send(JSON.stringify({ action: 'watch_vehicle', vehicleId: kuVehicle.id }));
    await sleep(700);
    const watching = events.filter((e) => e.event === 'watching').map((e) => e.data.vehicleId);
    assert.deepStrictEqual(watching, [kuVehicle.id], 'only the own-tenant vehicle may be watched');
    assert.ok(events.some((e) => e.event === 'error' && e.data.code === 'VEHICLE_NOT_FOUND'));
  } finally { ws.close(); }
});

test('review #4: assigning a route via assignedRouteId notifies drivers and passengers', async () => {
  const v = (await api(ku.token, 'GET', '/fleet/vehicles')).body.data.find((x) => x.assignedRouteId);
  const { ws, events } = await openSocket(passenger.token);
  try {
    await api(ku.token, 'PUT', `/fleet/vehicles/${v.id}`, { assignedRouteId: v.assignedRouteId });
    await sleep(700);
    const e = events.find((x) => x.event === 'vehicle.route_updated');
    assert.ok(e, 'vehicle.route_updated expected');
    assert.strictEqual(e.data.vehicleId, v.id);
    assert.strictEqual(e.data.assignedRoute, v.assignedRoute);
  } finally { ws.close(); }
});

test('review #4: reordering a route\'s stops notifies the vehicles on that route', async () => {
  const routes = (await api(ku.token, 'GET', '/fleet/routes')).body.data;
  const route = routes.find((r) => r.vehicleCount > 0 && r.stopCount > 1);
  const detail = (await api(ku.token, 'GET', `/fleet/routes/${route.id}`)).body.data;
  const { ws, events } = await openSocket(passenger.token);
  try {
    await api(ku.token, 'PUT', `/fleet/routes/${route.id}/stops`, { stopIds: detail.stops.map((s) => s.stopId) });
    await sleep(700);
    const ids = events.filter((x) => x.event === 'vehicle.route_updated').map((x) => x.data.vehicleId);
    for (const veh of detail.vehicles) assert.ok(ids.includes(veh.id), `${veh.vehicleNumber} must be notified`);
  } finally { ws.close(); }
});

test('review #5: a driver location report marks the vehicle\'s device as seen', async () => {
  const assignment = (await api(driver.token, 'GET', '/driver/me/assignment')).body.data;
  const post = await api(driver.token, 'POST', '/driver/trips/current/location', { latitude: 22.86, longitude: 89.52, speed: 10, timestamp: new Date().toISOString() });
  assert.strictEqual(post.status, 200, JSON.stringify(post.body));
  const after = (await api(ku.token, 'GET', '/fleet/devices')).body.data.find((d) => d.vehicle.id === assignment.vehicle.id);
  assert.strictEqual(after.isOnline, true);
  assert.ok(Date.now() - new Date(after.lastSeenAt).getTime() < 15000, 'lastSeenAt must be fresh');
});

test('review #7: the legacy model-by-name path stays inside the tenant', async () => {
  const name = `PrivateModel${Date.now()}`;
  const apexModel = (await api(apex.token, 'POST', '/fleet/models', { make: 'Apex', model: name })).body.data;
  const created = await api(ku.token, 'POST', '/fleet/vehicles', { vehicleNumber: `Bus #L${Date.now() % 1000}`, plateNumber: `T-${Date.now()}`, model: name });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  try {
    assert.notStrictEqual(created.body.data.modelId, apexModel.id, 'must not link to another tenant\'s private model');
    const kuModels = (await api(ku.token, 'GET', '/fleet/models')).body.data.filter((m) => m.model === name);
    assert.strictEqual(kuModels.length, 1);
    assert.strictEqual(kuModels[0].isGlobal, false, 'a model created by name belongs to the tenant, not the global catalog');
    const apexSees = (await api(apex.token, 'GET', '/fleet/models')).body.data.filter((m) => m.model === name);
    assert.strictEqual(apexSees.length, 1, 'Apex must only see its own');
    assert.strictEqual(apexSees[0].id, apexModel.id);
  } finally {
    await api(ku.token, 'DELETE', `/fleet/vehicles/${created.body.data.id}`);
    await api(ku.token, 'DELETE', `/fleet/models/${created.body.data.modelId}`);
    await api(apex.token, 'DELETE', `/fleet/models/${apexModel.id}`);
  }
});

test('review #9: a malformed id is a clean 404 that leaks no server internals', async () => {
  const probes = [['GET', '/fleet/routes/abc'], ['GET', '/fleet/vehicles/abc'], ['PUT', '/fleet/stops/abc', { name: 'x' }], ['DELETE', '/fleet/models/abc']];
  for (const [m, p, b] of probes) {
    const r = await api(ku.token, m, p, b);
    assert.strictEqual(r.status, 404, `${m} ${p} → ${r.status}`);
    assert.ok(!LEAK.test(JSON.stringify(r.body)), `${m} ${p} leaked internals: ${JSON.stringify(r.body).slice(0, 160)}`);
  }
});

test('review #9: a malformed id in a request body is rejected without leaking internals', async () => {
  const r = await api(ku.token, 'POST', '/fleet/vehicles', { vehicleNumber: 'Bus #BAD', plateNumber: 'BAD-1', modelId: 'not-a-uuid' });
  assert.ok([404, 422].includes(r.status), `status ${r.status}`);
  assert.ok(!LEAK.test(JSON.stringify(r.body)), JSON.stringify(r.body).slice(0, 160));
});
