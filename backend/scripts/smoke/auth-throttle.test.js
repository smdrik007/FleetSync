'use strict';
// A public API must not allow unlimited password guessing against one account.
const test = require('node:test');
const assert = require('node:assert');
const { api } = require('./helpers');

const KU = '00000000-0000-4000-a000-000000000001';
const login = (email, password) => api(null, 'POST', '/auth/login', { institutionId: KU, email, password });

test('login: the 11th failed attempt for one account is throttled, other accounts are unaffected', async () => {
  const email = `nobody.${Date.now()}@ku.edu.bd`; // a unique, non-existent account: nothing real gets locked out
  for (let i = 1; i <= 10; i++) {
    const r = await login(email, 'wrong-password');
    assert.strictEqual(r.status, 401, `attempt ${i} must be a normal 401`);
  }
  const blocked = await login(email, 'wrong-password');
  assert.strictEqual(blocked.status, 429);
  assert.strictEqual(blocked.body.error.code, 'TOO_MANY_ATTEMPTS');

  const other = await login('passenger@ku.edu.bd', 'demo1234');
  assert.strictEqual(other.status, 200, 'a different account from the same IP still signs in');
});

test('login: a successful sign-in clears earlier failures', async () => {
  for (let i = 0; i < 3; i++) assert.strictEqual((await login('karim@ku.edu.bd', 'nope-nope')).status, 401);
  assert.strictEqual((await login('karim@ku.edu.bd', 'demo1234')).status, 200);
});
