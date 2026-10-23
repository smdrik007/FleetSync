'use strict';
// Institution contact details: set by the authority, read by drivers and passengers of that institution only.
const test = require('node:test');
const assert = require('node:assert');
const { login, api } = require('./helpers');
const prisma = require('../../src/db/client');

test.after(async () => { await prisma.$disconnect(); });

test('contact: authority sets it, driver and passenger read their own institution\'s, other tenant sees its own', async () => {
  const ku = await login('authority@ku.edu.bd');
  const original = (await api(ku.token, 'GET', '/fleet/institution')).body.data;
  try {
    const put = await api(ku.token, 'PUT', '/fleet/institution', { contactPhone: ' +880 1711-000000 ', contactEmail: 'transport@ku.edu.bd', contactAddress: 'Transport office, KU' });
    assert.strictEqual(put.status, 200, JSON.stringify(put.body));
    assert.strictEqual(put.body.data.contactPhone, '+880 1711-000000'); // trimmed

    for (const who of ['rahim@ku.edu.bd', 'passenger@ku.edu.bd']) {
      const s = await login(who);
      const r = await api(s.token, 'GET', '/contact');
      assert.strictEqual(r.status, 200, `${who}: ${JSON.stringify(r.body)}`);
      assert.deepStrictEqual(r.body.data, { name: original.name, contactPhone: '+880 1711-000000', contactEmail: 'transport@ku.edu.bd', contactAddress: 'Transport office, KU' });
    }

    const apex = await login('authority@apex.com');
    const other = await api(apex.token, 'GET', '/contact');
    assert.strictEqual(other.status, 200);
    assert.notStrictEqual(other.body.data.contactEmail, 'transport@ku.edu.bd', 'another tenant must not see KU contacts');

    // Empty string clears a field; the others stay.
    const clear = await api(ku.token, 'PUT', '/fleet/institution', { contactPhone: '' });
    assert.strictEqual(clear.body.data.contactPhone, null);
    assert.strictEqual(clear.body.data.contactEmail, 'transport@ku.edu.bd');
  } finally {
    await prisma.institution.update({ where: { id: original.id }, data: { contactPhone: original.contactPhone, contactEmail: original.contactEmail, contactAddress: original.contactAddress } });
  }
});

test('contact: validation and auth', async () => {
  const ku = await login('authority@ku.edu.bd');
  assert.strictEqual((await api(ku.token, 'PUT', '/fleet/institution', { contactEmail: 'not-an-email' })).status, 422);
  assert.strictEqual((await api(ku.token, 'PUT', '/fleet/institution', { contactAddress: 'x'.repeat(301) })).status, 422);
  assert.strictEqual((await api(null, 'GET', '/contact')).status, 401);
  const driver = await login('rahim@ku.edu.bd');
  assert.strictEqual((await api(driver.token, 'PUT', '/fleet/institution', { contactPhone: '1' })).status, 403, 'drivers cannot edit contacts');
});
