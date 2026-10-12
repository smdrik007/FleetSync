'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { login, api } = require('./helpers');

test('login returns a token for the seeded KU authority', async () => {
  const s = await login('authority@ku.edu.bd');
  assert.ok(s.token);
  assert.strictEqual(s.institutionId, '00000000-0000-4000-a000-000000000001');
});

test('api() returns status and body without throwing', async () => {
  const { token } = await login('authority@ku.edu.bd');
  const me = await api(token, 'GET', '/auth/me');
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.body.data.email, 'authority@ku.edu.bd');
});

test('unauthenticated request is rejected with 401', async () => {
  const r = await api(null, 'GET', '/fleet/vehicles');
  assert.strictEqual(r.status, 401);
});
