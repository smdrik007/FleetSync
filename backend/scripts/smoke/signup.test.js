'use strict';
// Self-service sign-up and what each tracking type gets: vehicle -> fleet APIs, people/things -> people APIs.
const test = require('node:test');
const assert = require('node:assert');
const { api, login } = require('./helpers');
const prisma = require('../../src/db/client');

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created = [];

test.after(async () => {
  await prisma.institution.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

async function signup(trackingType, extra = {}) {
  const n = stamp();
  const body = { institutionName: `Signup ${trackingType} ${n}`, trackingType, name: 'Owner', email: `owner.${n}@signup.test`, password: 'demo1234', ...extra };
  const r = await api(null, 'POST', '/auth/signup', body);
  if (r.status === 201) created.push(r.body.data.institution.id);
  return { r, body };
}

test('sign-up validates input and refuses a duplicate email', async () => {
  const bad = async (patch, code) => {
    const { r } = await signup('vehicle', patch);
    assert.strictEqual(r.status, 422, JSON.stringify(r.body));
    assert.strictEqual(r.body.error.code, code);
  };
  await bad({ trackingType: 'boats' }, 'INVALID_TRACKINGTYPE');
  await bad({ trackingType: undefined }, 'INVALID_TRACKINGTYPE');
  await bad({ institutionName: 'x' }, 'INVALID_INSTITUTIONNAME');
  await bad({ name: '' }, 'INVALID_NAME');
  await bad({ email: 'not-an-email' }, 'INVALID_EMAIL');
  await bad({ password: 'short' }, 'WEAK_PASSWORD');

  const first = await signup('vehicle');
  assert.strictEqual(first.r.status, 201, JSON.stringify(first.r.body));
  const dup = await api(null, 'POST', '/auth/signup', { ...first.body, institutionName: 'Another name' });
  assert.strictEqual(dup.status, 409);
});

test('a vehicle sign-up gets the fleet and none of the people features', async () => {
  const { r, body } = await signup('vehicle');
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const d = r.body.data;
  assert.strictEqual(d.user.role, 'AUTHORITY');
  assert.strictEqual(d.user.trackingType, 'vehicle');
  assert.strictEqual(d.redirectTo, '/authority');
  assert.match(d.institution.slug, /^signup-vehicle-/);

  // The token works straight away, and so does a normal login.
  const again = await login(body.email, d.institution.id);
  assert.strictEqual(again.user.trackingType, 'vehicle');
  const roles = (await api(d.token, 'GET', '/fleet/roles')).body.data.map((x) => x.name).sort();
  assert.deepStrictEqual(roles, ['AUTHORITY', 'DRIVER', 'PASSENGER']);
  const sub = (await api(d.token, 'GET', '/fleet/subscription')).body.data;
  assert.strictEqual(sub.current.status, 'trial');
  assert.strictEqual(sub.current.planName, 'Trial');
  assert.ok(sub.current.daysRemaining >= 13 && sub.current.daysRemaining <= 14);

  assert.strictEqual((await api(d.token, 'GET', '/fleet/vehicles')).status, 200);
  assert.strictEqual((await api(d.token, 'GET', '/fleet/maintenance')).status, 200);
  for (const path of ['/fleet/people', '/fleet/guardians']) {
    const x = await api(d.token, 'GET', path);
    assert.strictEqual(x.status, 403, path);
    assert.strictEqual(x.body.error.code, 'FEATURE_DISABLED');
  }
  assert.strictEqual((await api(d.token, 'GET', '/guardian/people')).status, 403);
  // Shared screens stay.
  for (const path of ['/fleet/devices', '/fleet/notifications', '/fleet/users', '/fleet/institution', '/fleet/subscription']) {
    assert.strictEqual((await api(d.token, 'GET', path)).status, 200, path);
  }
  // Devices attach to vehicles only.
  const model = (await api(d.token, 'POST', '/fleet/models', { make: 'M', model: 'X' })).body.data;
  const veh = (await api(d.token, 'POST', '/fleet/vehicles', { vehicleNumber: 'V1', plateNumber: `P-${stamp()}`, modelId: model.id })).body.data;
  const toVehicle = await api(d.token, 'POST', '/fleet/devices', { vehicleId: veh.id, deviceType: 'esp32-json', imei: `sg-${stamp()}` });
  assert.strictEqual(toVehicle.status, 201, JSON.stringify(toVehicle.body));
  const toAsset = await api(d.token, 'POST', '/fleet/devices', { assetId: veh.id, deviceType: 'esp32-json', imei: `sg-${stamp()}` });
  assert.strictEqual(toAsset.status, 403);
  await prisma.device.deleteMany({ where: { institutionId: d.institution.id } });
});

for (const type of ['people', 'things']) {
  test(`a ${type} sign-up gets people features and no fleet features`, async () => {
    const { r } = await signup(type);
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const d = r.body.data;
    assert.strictEqual(d.user.trackingType, type);
    const roles = (await api(d.token, 'GET', '/fleet/roles')).body.data.map((x) => x.name).sort();
    assert.deepStrictEqual(roles, ['AUTHORITY', 'GUARDIAN'], 'no driver or passenger roles');

    for (const path of ['/fleet/vehicles', '/fleet/models', '/fleet/drivers', '/fleet/routes', '/fleet/stops', '/fleet/trips', '/fleet/positions', '/fleet/maintenance', '/fleet/fuel', '/fleet/costs', '/fleet/dashboard/summary']) {
      const x = await api(d.token, 'GET', path);
      assert.strictEqual(x.status, 403, path);
      assert.strictEqual(x.body.error.code, 'FEATURE_DISABLED', path);
    }
    assert.strictEqual((await api(d.token, 'GET', '/driver/me/assignment')).status, 403);
    for (const path of ['/fleet/people', '/fleet/guardians', '/fleet/devices', '/fleet/notifications', '/fleet/users', '/fleet/institution']) {
      assert.strictEqual((await api(d.token, 'GET', path)).status, 200, path);
    }

    // Add a person, a device on them, and a guardian who follows them.
    const person = (await api(d.token, 'POST', '/fleet/people', { name: 'Kid', consent: true })).body.data;
    const dev = await api(d.token, 'POST', '/fleet/devices', { assetId: person.id, deviceType: 'esp32-json', imei: `sg-${stamp()}` });
    assert.strictEqual(dev.status, 201, JSON.stringify(dev.body));
    assert.strictEqual((await api(d.token, 'POST', '/fleet/devices', { vehicleId: person.id, deviceType: 'esp32-json', imei: `sg-${stamp()}` })).status, 403, 'devices cannot attach to a vehicle');
    const gu = await api(d.token, 'POST', '/fleet/guardians', { name: 'Parent', email: `parent.${stamp()}@signup.test`, password: 'demo1234', links: [{ assetId: person.id, relationship: 'Mother' }] });
    assert.strictEqual(gu.status, 201, JSON.stringify(gu.body));
    const g = await login(gu.body.data.email, d.institution.id);
    assert.deepStrictEqual((await api(g.token, 'GET', '/guardian/people')).body.data.map((p) => p.id), [person.id]);
    await prisma.gpsLog.deleteMany({ where: { institutionId: d.institution.id } });
    await prisma.device.deleteMany({ where: { institutionId: d.institution.id } });
  });
}

test('the institution can switch its tracking type and the features follow at once', async () => {
  const { r } = await signup('vehicle');
  const d = r.body.data;
  assert.strictEqual((await api(d.token, 'GET', '/fleet/people')).status, 403);
  const bad = await api(d.token, 'PUT', '/fleet/institution', { trackingType: 'boats' });
  assert.strictEqual(bad.status, 422);
  const up = await api(d.token, 'PUT', '/fleet/institution', { trackingType: 'things' });
  assert.strictEqual(up.body.data.trackingType, 'things');
  assert.strictEqual((await api(d.token, 'GET', '/fleet/people')).status, 200, 'people features open immediately');
  assert.strictEqual((await api(d.token, 'GET', '/fleet/vehicles')).status, 403);
  const roles = (await api(d.token, 'GET', '/fleet/roles')).body.data.map((x) => x.name);
  assert.ok(roles.includes('GUARDIAN'), 'the role the new type needs is added');
});

test('existing demo institutions keep tracking vehicles', async () => {
  const ku = await login('authority@ku.edu.bd');
  assert.strictEqual(ku.user.trackingType, 'vehicle');
  assert.strictEqual((await api(ku.token, 'GET', '/fleet/vehicles')).status, 200);
  assert.strictEqual((await api(ku.token, 'GET', '/fleet/people')).status, 403);
});
