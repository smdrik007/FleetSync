'use strict';
// Guardians admin: the authority decides who may follow whom, and the change takes effect at once.
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { WS_URL, login, api, ensurePeopleTenant } = require('./helpers');
const prisma = require('../../src/db/client');

test.after(async () => { await prisma.$disconnect(); });

const uniq = () => `gdn-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('authority creates a guardian, grants and revokes people, and the live feed follows', async () => {
  const ku = await ensurePeopleTenant('a');
  const p1 = (await api(ku.token, 'POST', '/fleet/people', { name: `A ${uniq()}`, consent: true })).body.data;
  const p2 = (await api(ku.token, 'POST', '/fleet/people', { name: `B ${uniq()}`, consent: true })).body.data;
  const dev = (await api(ku.token, 'POST', '/fleet/devices', { assetId: p1.id, deviceType: 'esp32-json', imei: uniq() })).body.data;
  const email = `${uniq()}@people-a.test`;
  let gid;
  try {
    assert.strictEqual((await api(ku.token, 'POST', '/fleet/guardians', { name: 'G', email, password: 'short' })).status, 422, 'weak password');
    const made = await api(ku.token, 'POST', '/fleet/guardians', { name: 'Gina', email, phone: '+8801700000000', password: 'demo1234', links: [{ assetId: p1.id, relationship: ' Mother ' }] });
    assert.strictEqual(made.status, 201, JSON.stringify(made.body));
    gid = made.body.data.id;
    assert.deepStrictEqual(made.body.data.people.map((p) => [p.id, p.relationship]), [[p1.id, 'Mother']]);
    assert.strictEqual((await api(ku.token, 'POST', '/fleet/guardians', { name: 'G', email, password: 'demo1234' })).status, 409, 'email is unique');

    const listed = (await api(ku.token, 'GET', '/fleet/guardians')).body.data.find((g) => g.id === gid);
    assert.strictEqual(listed.phone, '+8801700000000');
    const person = (await api(ku.token, 'GET', '/fleet/people')).body.data.find((p) => p.id === p1.id);
    assert.deepStrictEqual(person.guardians.map((g) => g.relationship), ['Mother'], 'relationship shows on the person');

    // The guardian signs in and watches live.
    const g = await login(email, ku.institutionId);
    assert.deepStrictEqual((await api(g.token, 'GET', '/guardian/people')).body.data.map((p) => p.id), [p1.id]);
    const ws = new WebSocket(`${WS_URL}?token=${g.token}`);
    const events = [];
    ws.on('message', (m) => events.push(JSON.parse(m)));
    await new Promise((r) => ws.on('open', r));
    await sleep(400);   // rooms are joined after a lookup
    const send = () => fetch(`${process.env.API_BASE || 'http://localhost:3000/api/v1'}/ingest/json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dev.apiKey}` },
      body: JSON.stringify({ ts: new Date().toISOString(), lat: 22.85, lng: 89.54 }),
    });
    try {
      await send(); await sleep(400);
      assert.strictEqual(events.filter((e) => e.event === 'asset.location').length, 1, 'linked: receives the live position');

      // Swap access to the other person: the open socket stops receiving the first one immediately.
      const swapped = await api(ku.token, 'PUT', `/fleet/guardians/${gid}/people`, { links: [{ assetId: p2.id, relationship: 'Teacher' }] });
      assert.deepStrictEqual(swapped.body.data.people.map((p) => p.id), [p2.id]);
      await send(); await sleep(400);
      assert.strictEqual(events.filter((e) => e.event === 'asset.location').length, 1, 'revoked: no more live positions');
      assert.deepStrictEqual((await api(g.token, 'GET', '/guardian/people')).body.data.map((p) => p.id), [p2.id]);
      assert.strictEqual((await api(g.token, 'GET', `/guardian/people/${p1.id}/track`)).status, 404);
    } finally { ws.close(); }

    // Editing the person's guardian list keeps the relationship of a guardian who stays.
    await api(ku.token, 'PUT', `/fleet/people/${p2.id}/guardians`, { userIds: [gid] });
    const p2now = (await api(ku.token, 'GET', '/fleet/people')).body.data.find((p) => p.id === p2.id);
    assert.deepStrictEqual(p2now.guardians.map((x) => x.relationship), ['Teacher']);

    // Bad input and other tenants.
    assert.strictEqual((await api(ku.token, 'PUT', `/fleet/guardians/${gid}/people`, { links: [{ assetId: p1.id }, { assetId: p1.id }] })).status, 422, 'duplicates');
    const apex = await ensurePeopleTenant('b');
    assert.strictEqual((await api(apex.token, 'GET', '/fleet/guardians')).body.data.find((x) => x.id === gid), undefined);
    assert.strictEqual((await api(apex.token, 'PUT', `/fleet/guardians/${gid}/people`, { links: [] })).status, 404);
    assert.strictEqual((await api(apex.token, 'DELETE', `/fleet/guardians/${gid}`)).status, 404);
    const apexPerson = (await api(apex.token, 'POST', '/fleet/people', { name: `Apex ${uniq()}` })).body.data;
    try {
      assert.strictEqual((await api(ku.token, 'PUT', `/fleet/guardians/${gid}/people`, { links: [{ assetId: apexPerson.id }] })).status, 422, 'cannot grant another tenant\'s person');
    } finally { await prisma.asset.delete({ where: { id: apexPerson.id } }); }
    assert.strictEqual((await api(g.token, 'GET', '/fleet/guardians')).status, 403, 'guardians cannot manage guardians');

    // Staff accounts are not deleted from here.
    const authorityId = ku.user.id;
    assert.strictEqual((await api(ku.token, 'DELETE', `/fleet/guardians/${authorityId}`)).status, 404, 'not a guardian');

    const del = await api(ku.token, 'DELETE', `/fleet/guardians/${gid}`);
    assert.strictEqual(del.status, 200);
    gid = null;
    assert.strictEqual(await prisma.guardianship.count({ where: { assetId: { in: [p1.id, p2.id] } } }), 0, 'links go with the account');
  } finally {
    if (gid) await prisma.user.delete({ where: { id: gid } }).catch(() => {});
    await prisma.gpsLog.deleteMany({ where: { assetId: p1.id } });
    await prisma.device.delete({ where: { id: dev.id } });
    await prisma.asset.deleteMany({ where: { id: { in: [p1.id, p2.id] } } });
  }
});
