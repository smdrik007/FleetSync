'use strict';
// People tracking: consent gate, guardians, safe zones, alerts, retention and tenant isolation.
const test = require('node:test');
const assert = require('node:assert');
const { API_BASE, login, api, ensurePeopleTenant } = require('./helpers');
const prisma = require('../../src/db/client');
const { checkOffline, purgeOldPoints } = require('../../src/lib/alerts');

test.after(async () => { await prisma.$disconnect(); });

const post = (path, key, body) =>
  fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const uniq = () => `ppl-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
// Home is a 200 m zone around (22.8456, 89.5403); 0.01 degrees of latitude is about 1.1 km.
const HOME = { lat: 22.8456, lng: 89.5403 };
const AWAY = { lat: 22.8556, lng: 89.5403 };

async function setup() {
  const ku = await ensurePeopleTenant('a');
  await api(ku.token, 'GET', '/fleet/people');   // makes sure the GUARDIAN role exists
  const roles = (await api(ku.token, 'GET', '/fleet/roles')).body.data;
  const guardianRole = roles.find((r) => r.name === 'GUARDIAN');
  assert.ok(guardianRole, 'tenant has a GUARDIAN role');
  const email = `${uniq()}@people-a.test`;
  const gu = await api(ku.token, 'POST', '/fleet/users', { name: 'Test Guardian', email, password: 'demo1234', roleId: guardianRole.id });
  assert.strictEqual(gu.status, 201, JSON.stringify(gu.body));
  const name = `Kid ${uniq()}`;
  const person = (await api(ku.token, 'POST', '/fleet/people', { name })).body.data;
  const dev = (await api(ku.token, 'POST', '/fleet/devices', { assetId: person.id, deviceType: 'esp32-json', imei: uniq() })).body.data;
  return { ku, email, guardianId: gu.body.data.id, person, dev, name };
}

async function cleanup({ person, dev, guardianId, name }) {
  await prisma.notification.deleteMany({ where: { title: { contains: name } } });
  await prisma.gpsLog.deleteMany({ where: { assetId: person.id } });
  await prisma.device.deleteMany({ where: { id: dev.id } });
  await prisma.asset.delete({ where: { id: person.id } });
  await prisma.userRole.deleteMany({ where: { userId: guardianId } });
  await prisma.notification.deleteMany({ where: { userId: guardianId } });
  await prisma.user.delete({ where: { id: guardianId } });
}

test('consent gate: no points are stored until consent is recorded, and pause stops them again', async () => {
  const c = await setup();
  try {
    assert.strictEqual(c.dev.asset.id, c.person.id);
    assert.strictEqual(c.dev.vehicle, null);
    const p = { ts: iso(), ...HOME, battery: 90 };
    const refused = await post('/ingest/json', c.dev.apiKey, p);
    assert.strictEqual(refused.status, 403);
    assert.strictEqual(refused.body.error.code, 'CONSENT_REQUIRED');
    assert.strictEqual(await prisma.gpsLog.count({ where: { assetId: c.person.id } }), 0);

    const consent = await api(c.ku.token, 'PUT', `/fleet/people/${c.person.id}`, { consent: true, consentBy: 'Parent' });
    assert.strictEqual(consent.body.data.consentBy, 'Parent');
    assert.strictEqual((await post('/ingest/json', c.dev.apiKey, p)).status, 200);

    await api(c.ku.token, 'PUT', `/fleet/people/${c.person.id}`, { trackingPaused: true });
    assert.strictEqual((await post('/ingest/json', c.dev.apiKey, { ...p, ts: iso(-1000) })).body.error.code, 'TRACKING_PAUSED');
    await api(c.ku.token, 'PUT', `/fleet/people/${c.person.id}`, { trackingPaused: false });
    assert.strictEqual((await post('/ingest/json', c.dev.apiKey, { ...p, ts: iso(-2000) })).status, 200);

    const listed = (await api(c.ku.token, 'GET', '/fleet/people')).body.data.find((x) => x.id === c.person.id);
    assert.strictEqual(listed.position.lat, HOME.lat);
    assert.strictEqual(listed.position.isStale, false);
    assert.strictEqual(listed.device.batteryPct, 90);
    assert.strictEqual(listed.device.isOnline, true);
    assert.ok(Math.abs(new Date(listed.position.recordedAt) - Date.now()) < 60_000, 'times are stored as UTC, not shifted by the DB zone');

    const trail = await api(c.ku.token, 'GET', `/fleet/people/${c.person.id}/track?hours=1`);
    assert.ok(trail.body.data.length >= 1);
    // A people institution has no fleet APIs at all.
    const fleet = await api(c.ku.token, 'GET', '/fleet/positions');
    assert.strictEqual(fleet.status, 403);
    assert.strictEqual(fleet.body.error.code, 'FEATURE_DISABLED');
  } finally { await cleanup(c); }
});

test('guardians see only their own people and nothing of the fleet console', async () => {
  const c = await setup();
  try {
    await api(c.ku.token, 'PUT', `/fleet/people/${c.person.id}`, { consent: true });
    const link = await api(c.ku.token, 'PUT', `/fleet/people/${c.person.id}/guardians`, { userIds: [c.guardianId] });
    assert.deepStrictEqual(link.body.data.guardians.map((g) => g.id), [c.guardianId]);
    await post('/ingest/json', c.dev.apiKey, { ts: iso(), ...HOME });

    const g = await login(c.email, c.ku.institutionId);
    assert.strictEqual(g.user.role, 'GUARDIAN');
    const mine = await api(g.token, 'GET', '/guardian/people');
    assert.deepStrictEqual(mine.body.data.map((p) => p.id), [c.person.id]);
    assert.strictEqual(mine.body.data[0].guardians, undefined, 'guardians do not see who else follows');
    assert.strictEqual((await api(g.token, 'GET', `/guardian/people/${c.person.id}/track`)).status, 200);

    // Guardians manage safe zones for their own people.
    const added = await api(g.token, 'POST', `/guardian/people/${c.person.id}/geofences`, { name: 'Home', latitude: HOME.lat, longitude: HOME.lng, radiusM: 150 });
    assert.strictEqual(added.status, 201, JSON.stringify(added.body));
    assert.deepStrictEqual(added.body.data.geofences.map((z) => [z.name, z.radiusM]), [['Home', 150]]);
    assert.strictEqual((await api(g.token, 'POST', `/guardian/people/${c.person.id}/geofences`, { name: 'x', latitude: HOME.lat, longitude: HOME.lng, radiusM: 10 })).status, 422);
    const zoneId = added.body.data.geofences[0].id;

    assert.strictEqual((await api(g.token, 'GET', '/fleet/people')).status, 403, 'not the authority console');
    assert.strictEqual((await api(g.token, 'GET', '/fleet/vehicles')).status, 403);

    // A second guardian, not linked, sees nothing and cannot read the trail.
    const roles = (await api(c.ku.token, 'GET', '/fleet/roles')).body.data;
    const email2 = `${uniq()}@people-a.test`;
    const g2u = (await api(c.ku.token, 'POST', '/fleet/users', { name: 'Other', email: email2, password: 'demo1234', roleId: roles.find((r) => r.name === 'GUARDIAN').id })).body.data;
    try {
      const g2 = await login(email2, c.ku.institutionId);
      assert.deepStrictEqual((await api(g2.token, 'GET', '/guardian/people')).body.data, []);
      assert.strictEqual((await api(g2.token, 'GET', `/guardian/people/${c.person.id}/track`)).status, 404);
      assert.strictEqual((await api(g2.token, 'POST', `/guardian/people/${c.person.id}/geofences`, { name: 'x', latitude: 1, longitude: 1, radiusM: 100 })).status, 404);
      assert.strictEqual((await api(g2.token, 'DELETE', `/guardian/people/${c.person.id}/geofences/${zoneId}`)).status, 404);
    } finally {
      await prisma.userRole.deleteMany({ where: { userId: g2u.id } });
      await prisma.user.delete({ where: { id: g2u.id } });
    }

    const removed = await api(g.token, 'DELETE', `/guardian/people/${c.person.id}/geofences/${zoneId}`);
    assert.deepStrictEqual(removed.body.data.geofences, []);

    // Only users with the GUARDIAN role can be linked.
    assert.strictEqual((await api(c.ku.token, 'PUT', `/fleet/people/${c.person.id}/guardians`, { userIds: [c.ku.user.id] })).status, 422, 'the authority user is not a guardian');
  } finally { await cleanup(c); }
});

test('alerts fire once per change: leaving a zone, low battery, SOS; guardians and authority are told', async () => {
  const c = await setup();
  try {
    await api(c.ku.token, 'PUT', `/fleet/people/${c.person.id}`, { consent: true });
    await api(c.ku.token, 'PUT', `/fleet/people/${c.person.id}/guardians`, { userIds: [c.guardianId] });
    const zone = await api(c.ku.token, 'POST', `/fleet/people/${c.person.id}/geofences`, { name: 'Home', latitude: HOME.lat, longitude: HOME.lng, radiusM: 200 });
    assert.strictEqual(zone.status, 201);
    assert.strictEqual((await api(c.ku.token, 'POST', `/fleet/people/${c.person.id}/geofences`, { name: 'x', latitude: 1, longitude: 1, radiusM: 5 })).status, 422, 'too small');

    const titles = async (userId) => (await prisma.notification.findMany({ where: { userId, title: { contains: c.name } }, orderBy: { createdAt: 'asc' } })).map((n) => n.title);
    const authorityId = c.ku.user.id;
    const send = (p) => post('/ingest/json', c.dev.apiKey, p);

    await send({ ts: iso(50_000), ...HOME, battery: 80 });
    assert.deepStrictEqual(await titles(c.guardianId), [], 'the first reading only sets the state');
    await send({ ts: iso(40_000), ...AWAY, battery: 79 });
    await send({ ts: iso(30_000), ...AWAY, battery: 78 });
    assert.deepStrictEqual(await titles(c.guardianId), [`${c.name} left Home`], 'one alert, not one per report');
    assert.deepStrictEqual(await titles(authorityId), [`${c.name} left Home`], 'authority is told too');

    await send({ ts: iso(20_000), ...AWAY, battery: 15 });
    await send({ ts: iso(10_000), ...AWAY, battery: 14 });
    await send({ ts: iso(5_000), ...AWAY, battery: 14, sos: true });
    await send({ ts: iso(4_000), ...AWAY, battery: 14, sos: true });
    await send({ ts: iso(3_000), ...HOME, battery: 14 });
    assert.deepStrictEqual(await titles(c.guardianId), [
      `${c.name} left Home`, `Low battery: ${c.name}`, `SOS from ${c.name}`, `${c.name} arrived: Home`,
    ]);

    // Removing the zone works; the person detail reflects it.
    const gone = await api(c.ku.token, 'DELETE', `/fleet/people/${c.person.id}/geofences/${zone.body.data.geofences[0].id}`);
    assert.deepStrictEqual(gone.body.data.geofences, []);
  } finally { await cleanup(c); }
});

test('silence raises one "no signal" alert, and retention purges old points', async () => {
  const c = await setup();
  try {
    await api(c.ku.token, 'PUT', `/fleet/people/${c.person.id}`, { consent: true, retentionDays: 7 });
    await api(c.ku.token, 'PUT', `/fleet/people/${c.person.id}/guardians`, { userIds: [c.guardianId] });
    await post('/ingest/json', c.dev.apiKey, { ts: iso(), ...HOME });

    // Make the device look silent for an hour (the column holds UTC wall time).
    await prisma.$executeRaw`UPDATE devices SET last_seen_at = (now() AT TIME ZONE 'UTC') - interval '1 hour' WHERE id = ${c.dev.id}::uuid`;
    await checkOffline();
    await checkOffline();
    const alerts = await prisma.notification.findMany({ where: { userId: c.guardianId, title: `No signal: ${c.name}` } });
    assert.strictEqual(alerts.length, 1, 'alerts once while it stays silent');
    // Reporting again clears the flag, so a later silence alerts again.
    await post('/ingest/json', c.dev.apiKey, { ts: iso(-1000), ...HOME });
    assert.strictEqual((await prisma.device.findUnique({ where: { id: c.dev.id } })).offlineAlerted, false);

    // An old point is purged, a fresh one stays.
    await post('/ingest/json', c.dev.apiKey, { ts: iso(10 * 24 * 3600 * 1000), lat: 22.85, lng: 89.54 });
    assert.strictEqual(await prisma.gpsLog.count({ where: { assetId: c.person.id } }), 3);
    await purgeOldPoints();
    assert.strictEqual(await prisma.gpsLog.count({ where: { assetId: c.person.id } }), 2);
  } finally { await cleanup(c); }
});

test('tenant isolation: another institution cannot see, change, or attach devices to a person', async () => {
  const c = await setup();
  try {
    const apex = await ensurePeopleTenant('b');
    assert.strictEqual((await api(apex.token, 'GET', '/fleet/people')).body.data.find((p) => p.id === c.person.id), undefined);
    assert.strictEqual((await api(apex.token, 'PUT', `/fleet/people/${c.person.id}`, { name: 'x' })).status, 404);
    assert.strictEqual((await api(apex.token, 'DELETE', `/fleet/people/${c.person.id}`)).status, 404);
    assert.strictEqual((await api(apex.token, 'PUT', `/fleet/people/${c.person.id}/guardians`, { userIds: [] })).status, 404);
    const attach = await api(apex.token, 'POST', '/fleet/devices', { assetId: c.person.id, deviceType: 'esp32-json', imei: uniq() });
    assert.strictEqual(attach.status, 422);
    // A device cannot target a vehicle and a person at once, and a person with a device cannot be deleted.
    const both = await api(c.ku.token, 'POST', '/fleet/devices', { assetId: c.person.id, vehicleId: c.person.id, deviceType: 'esp32-json', imei: uniq() });
    assert.strictEqual(both.status, 422);
    assert.strictEqual((await api(c.ku.token, 'DELETE', `/fleet/people/${c.person.id}`)).status, 409);
  } finally { await cleanup(c); }
});
