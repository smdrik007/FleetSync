'use strict';
// A vehicle with no tracker must still store GPS: Start Trip gives it a phone device (mobile app).
const test = require('node:test');
const assert = require('node:assert');
const { login, api } = require('./helpers');
const prisma = require('../../src/db/client');

test.after(async () => { await prisma.$disconnect(); });

test('phone tracker: a vehicle with no device stores GPS points after Start Trip', async () => {
  const ku = await login('authority@ku.edu.bd');
  const n = `${Date.now()}`;
  const email = `phone.${n}@ku.edu.bd`;
  const drv = await api(ku.token, 'POST', '/fleet/drivers', { name: `Phone Test ${n}`, email, phone: `+8801${n.slice(-9)}`, password: 'demo1234', licenseNumber: `PT-${n}` });
  assert.strictEqual(drv.status, 201, JSON.stringify(drv.body));
  let vehicleId;
  try {
    const model = (await api(ku.token, 'GET', '/fleet/models')).body.data[0];
    const veh = await api(ku.token, 'POST', '/fleet/vehicles', { vehicleNumber: `PT-${n.slice(-6)}`, plateNumber: `PT-${n}`, modelId: model.id, assignedDriverId: drv.body.data.id });
    assert.strictEqual(veh.status, 201, JSON.stringify(veh.body));
    vehicleId = veh.body.data.id;
    assert.strictEqual(await prisma.device.count({ where: { vehicleId } }), 0, 'precondition: vehicle has no device');
    const session = await login(email);

    const start = await api(session.token, 'POST', '/driver/trips/start');
    assert.strictEqual(start.status, 201, JSON.stringify(start.body));
    const tripId = start.body.data.tripId;

    const post = await api(session.token, 'POST', `/driver/trips/${tripId}/location`, { latitude: 22.86, longitude: 89.52, speed: 5, timestamp: new Date().toISOString() });
    assert.strictEqual(post.status, 200, JSON.stringify(post.body));

    assert.strictEqual(await prisma.gpsLog.count({ where: { tripId } }), 1, 'the point must be stored, not silently dropped');
    const devices = await prisma.device.findMany({ where: { vehicleId } });
    assert.deepStrictEqual(devices.map((d) => d.deviceType), ['phone']);

    // A second trip must reuse that device, not add another.
    await api(session.token, 'POST', `/driver/trips/${tripId}/end`);
    const again = await api(session.token, 'POST', '/driver/trips/start');
    assert.strictEqual(again.status, 201, JSON.stringify(again.body));
    await api(session.token, 'POST', `/driver/trips/${again.body.data.tripId}/end`);
    assert.strictEqual(await prisma.device.count({ where: { vehicleId } }), 1);
  } finally {
    // Leave the demo data as we found it.
    if (vehicleId) {
      await prisma.gpsLog.deleteMany({ where: { vehicleId } });
      await prisma.vehicleLatestPosition.deleteMany({ where: { vehicleId } });
      await prisma.trip.deleteMany({ where: { vehicleId } });
      await prisma.device.deleteMany({ where: { vehicleId } });
      await prisma.vehicle.delete({ where: { id: vehicleId } });
    }
    await prisma.driver.delete({ where: { id: drv.body.data.id } });
    await prisma.userRole.deleteMany({ where: { userId: drv.body.data.userId } });
    await prisma.user.delete({ where: { id: drv.body.data.userId } });
  }
});
