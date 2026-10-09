'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { login, api } = require('./helpers');
const prisma = require('../../src/db/client');

let ku, apex, driverSession, roles, apexRoles;
const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
test.before(async () => {
  ku = await login('authority@ku.edu.bd');
  apex = await login('authority@apex.com');
  driverSession = await login('rahim@ku.edu.bd');
  roles = (await api(ku.token, 'GET', '/fleet/roles')).body.data;
  apexRoles = (await api(apex.token, 'GET', '/fleet/roles')).body.data;
});
test.after(async () => { await prisma.$disconnect(); });

const role = (name) => roles.find((r) => r.name === name);

test('admin: users list carries roles and never a password hash', async () => {
  const r = await api(ku.token, 'GET', '/fleet/users');
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.data.length >= 4);
  assert.ok(r.body.data.every((u) => !('passwordHash' in u) && Array.isArray(u.roles)));
  const rahim = r.body.data.find((u) => u.email === 'rahim@ku.edu.bd');
  assert.deepStrictEqual(rahim.roles, ['DRIVER']);
  assert.ok(rahim.driverId);
});

test('admin: a created user can log in; duplicate email is 409', async () => {
  const email = `smoke${stamp()}@ku.edu.bd`;
  try {
    const c = await api(ku.token, 'POST', '/fleet/users', { name: 'Smoke User', email, password: 'longenough1', roleId: role('PASSENGER').id });
    assert.strictEqual(c.status, 201, JSON.stringify(c.body));
    assert.ok(!('passwordHash' in c.body.data));
    const session = await api(null, 'POST', '/auth/login', { institutionId: ku.institutionId, email, password: 'longenough1' });
    assert.strictEqual(session.status, 200);
    assert.strictEqual(session.body.data.user.role, 'PASSENGER');
    const dup = await api(ku.token, 'POST', '/fleet/users', { name: 'Again', email, password: 'longenough1', roleId: role('PASSENGER').id });
    assert.strictEqual(dup.status, 409);
  } finally { await prisma.user.deleteMany({ where: { email } }); }
});

test('admin: user creation rejects foreign roles and weak passwords (422)', async () => {
  const email = `smoke${stamp()}@ku.edu.bd`;
  const foreign = await api(ku.token, 'POST', '/fleet/users', { name: 'X', email, password: 'longenough1', roleId: apexRoles[0].id });
  assert.strictEqual(foreign.status, 422);
  assert.strictEqual(foreign.body.error.code, 'INVALID_ROLE');
  const weak = await api(ku.token, 'POST', '/fleet/users', { name: 'X', email, password: 'short', roleId: role('PASSENGER').id });
  assert.strictEqual(weak.status, 422);
  assert.strictEqual(weak.body.error.code, 'WEAK_PASSWORD');
});

test('admin: role assignment swaps roles, enforces ≥1 role, blocks self-demotion', async () => {
  const email = `smoke${stamp()}@ku.edu.bd`;
  try {
    const u = (await api(ku.token, 'POST', '/fleet/users', { name: 'Swap', email, password: 'longenough1', roleId: role('PASSENGER').id })).body.data;
    const sw = await api(ku.token, 'PUT', `/fleet/users/${u.id}/roles`, { roleIds: [role('DRIVER').id] });
    assert.strictEqual(sw.status, 200);
    assert.deepStrictEqual(sw.body.data.roles, ['DRIVER']);
    assert.strictEqual((await api(ku.token, 'PUT', `/fleet/users/${u.id}/roles`, { roleIds: [] })).status, 422);
    assert.strictEqual((await api(ku.token, 'PUT', `/fleet/users/${u.id}/roles`, { roleIds: [apexRoles[0].id] })).status, 422);
    const self = await api(ku.token, 'PUT', `/fleet/users/${ku.user.id}/roles`, { roleIds: [role('PASSENGER').id] });
    assert.strictEqual(self.status, 422);
    assert.strictEqual(self.body.error.code, 'CANNOT_DEMOTE_SELF');
  } finally { await prisma.user.deleteMany({ where: { email } }); }
});

test('admin: another tenant cannot edit a user (404)', async () => {
  const rahim = (await api(ku.token, 'GET', '/fleet/users')).body.data.find((u) => u.email === 'rahim@ku.edu.bd');
  assert.strictEqual((await api(apex.token, 'PUT', `/fleet/users/${rahim.id}`, { name: 'Hijack' })).status, 404);
});

test('admin: roles carry counts; AUTHORITY holds every permission', async () => {
  assert.ok(role('AUTHORITY').userCount >= 1);
  const perms = (await api(ku.token, 'GET', '/fleet/permissions')).body.data;
  assert.ok(perms.length >= 6 && perms[0].code);
  const held = (await api(ku.token, 'GET', `/fleet/roles/${role('AUTHORITY').id}/permissions`)).body.data;
  assert.strictEqual(held.length, perms.length);
  assert.strictEqual((await api(ku.token, 'GET', `/fleet/roles/${apexRoles[0].id}/permissions`)).status, 404);
});

test('admin: subscription and institution', async () => {
  const s = (await api(ku.token, 'GET', '/fleet/subscription')).body.data;
  assert.strictEqual(s.current.status, 'active');
  assert.strictEqual(s.current.planName, 'Professional');
  assert.ok(s.history.length >= 1);
  const inst = (await api(ku.token, 'GET', '/fleet/institution')).body.data;
  const renamed = await api(ku.token, 'PUT', '/fleet/institution', { name: `${inst.name} (edited)`, slug: 'hacked' });
  assert.strictEqual(renamed.body.data.name, `${inst.name} (edited)`);
  assert.strictEqual(renamed.body.data.slug, inst.slug, 'slug is read-only');
  await api(ku.token, 'PUT', '/fleet/institution', { name: inst.name });
  assert.strictEqual((await api(ku.token, 'PUT', '/fleet/institution', { name: '  ' })).status, 422);
});

test('admin: non-authority roles are forbidden from admin endpoints (403)', async () => {
  for (const p of ['/fleet/users', '/fleet/roles', '/fleet/subscription', '/fleet/institution']) {
    assert.strictEqual((await api(driverSession.token, 'GET', p)).status, 403, p);
  }
});

test('admin: driver lifecycle — create, edit, validate, delete', async () => {
  const email = `drv${stamp()}@ku.edu.bd`;
  const lic = `LIC-${stamp()}`;
  try {
    const c = await api(ku.token, 'POST', '/fleet/drivers', { name: 'Temp Driver', email, phone: `+88017${stamp()}`.slice(0, 14), password: 'longenough1', licenseNumber: lic });
    assert.strictEqual(c.status, 201, JSON.stringify(c.body));
    const id = c.body.data.id;
    const dup = await api(ku.token, 'POST', '/fleet/drivers', { name: 'Dup', email, phone: '+8801000000001', password: 'longenough1', licenseNumber: `${lic}-2` });
    assert.strictEqual(dup.status, 409);
    const u = await api(ku.token, 'PUT', `/fleet/drivers/${id}`, { employmentStatus: 'on_leave', licenseExpiry: '2027-05-01', licenseClass: 'Medium' });
    assert.strictEqual(u.status, 200);
    assert.strictEqual(u.body.data.employmentStatus, 'on_leave');
    assert.strictEqual((await api(ku.token, 'PUT', `/fleet/drivers/${id}`, { employmentStatus: 'sleeping' })).status, 422);
    const list = (await api(ku.token, 'GET', '/fleet/drivers')).body.data.find((d) => d.id === id);
    assert.strictEqual(list.licenseNumber, lic);
    assert.strictEqual(list.employmentStatus, 'on_leave');
    assert.strictEqual((await api(apex.token, 'DELETE', `/fleet/drivers/${id}`)).status, 404);
    assert.strictEqual((await api(ku.token, 'DELETE', `/fleet/drivers/${id}`)).status, 200);
  } finally { await prisma.user.deleteMany({ where: { email } }); }
});

test('admin: a driver with trips cannot be deleted (409)', async () => {
  const rahim = (await api(ku.token, 'GET', '/fleet/drivers')).body.data.find((d) => d.email === 'rahim@ku.edu.bd');
  const r = await api(ku.token, 'DELETE', `/fleet/drivers/${rahim.id}`);
  assert.strictEqual(r.status, 409);
});

test('admin: duplicate license number within a tenant is 409 on update', async () => {
  const drivers = (await api(ku.token, 'GET', '/fleet/drivers')).body.data;
  const [a, b] = drivers;
  const r = await api(ku.token, 'PUT', `/fleet/drivers/${b.id}`, { licenseNumber: a.licenseNumber });
  assert.strictEqual(r.status, 409);
});
