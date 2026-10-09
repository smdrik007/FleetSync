'use strict';
/**
 * Smoke-test helpers. Tests run against a live API (default http://localhost:3000)
 * and the seeded DB. Override with API_BASE=http://localhost:3100/api/v1.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');

const API_BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';
const WS_URL   = API_BASE.replace(/^http/, 'ws').replace(/\/api\/v1$/, '/ws');

const INSTITUTIONS = { 'ku.edu.bd': '00000000-0000-4000-a000-000000000001', 'apex.com': '00000000-0000-4000-a000-000000000002' };
const EMPTY_TENANT = { id: '00000000-0000-4000-a000-000000000099', slug: 'empty-test', email: 'authority@empty.test' };

async function api(token, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
}

async function login(email, institutionId) {
  const inst = institutionId || INSTITUTIONS[email.split('@')[1]] || EMPTY_TENANT.id;
  const r = await api(null, 'POST', '/auth/login', { institutionId: inst, email, password: 'demo1234' });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.data.token, user: r.body.data.user, institutionId: r.body.data.user.institutionId };
}

/** Idempotently creates a tenant with an AUTHORITY user and no fleet data; returns a login session. */
async function ensureEmptyTenant() {
  const prisma = require('../../src/db/client');
  const inst = await prisma.institution.upsert({
    where: { slug: EMPTY_TENANT.slug }, update: {},
    create: { id: EMPTY_TENANT.id, name: 'Empty Test Tenant', slug: EMPTY_TENANT.slug },
  });
  const role = await prisma.role.upsert({
    where: { uq_roles_name: { institutionId: inst.id, name: 'AUTHORITY' } }, update: {},
    create: { institutionId: inst.id, name: 'AUTHORITY', isSystem: true },
  });
  await prisma.user.upsert({
    where: { email: EMPTY_TENANT.email }, update: {},
    create: {
      institutionId: inst.id, name: 'Empty Authority', email: EMPTY_TENANT.email,
      passwordHash: bcrypt.hashSync('demo1234', 10),
      userRoles: { create: [{ roleId: role.id, institutionId: inst.id }] },
    },
  });
  const pRole = await prisma.role.upsert({
    where: { uq_roles_name: { institutionId: inst.id, name: 'PASSENGER' } }, update: {},
    create: { institutionId: inst.id, name: 'PASSENGER', isSystem: true },
  });
  await prisma.user.upsert({
    where: { email: 'passenger@empty.test' }, update: {},
    create: {
      institutionId: inst.id, name: 'Empty Passenger', email: 'passenger@empty.test',
      passwordHash: bcrypt.hashSync('demo1234', 10),
      userRoles: { create: [{ roleId: pRole.id, institutionId: inst.id }] },
    },
  });
  return login(EMPTY_TENANT.email, inst.id);
}

module.exports = { API_BASE, WS_URL, api, login, ensureEmptyTenant };
