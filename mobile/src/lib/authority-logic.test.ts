import assert from 'node:assert';
import test from 'node:test';
import {
  applyLocation, countByStatus, fmtKm, fmtLitres, fmtMoney, fromPositionRow, isStale, matches, nearestPos,
  positionsToGeoJson, statusLabel, unreadCount,
} from './authority-logic.ts';

test('fmtMoney groups thousands, keeps at most 2 decimals and shows a dash for missing values', () => {
  assert.strictEqual(fmtMoney(0), '৳ 0');
  assert.strictEqual(fmtMoney(1234567.5), '৳ 1,234,567.5');
  assert.strictEqual(fmtMoney(1.005 * 100), '৳ 100.5');
  assert.strictEqual(fmtMoney(999.999), '৳ 1,000');
  assert.strictEqual(fmtMoney(null), '—');
  assert.strictEqual(fmtMoney(undefined), '—');
});

test('distance, litres and status labels', () => {
  assert.strictEqual(fmtKm(12.345), '12.3 km');
  assert.strictEqual(fmtKm(null), '—');
  assert.strictEqual(fmtLitres(2.04), '2.0 L');
  assert.strictEqual(fmtLitres(null), '—');
  assert.strictEqual(statusLabel('on_trip'), 'On trip');
  assert.strictEqual(statusLabel('idle'), 'Idle');
});

test('countByStatus lists every status and tolerates unknown ones', () => {
  assert.deepStrictEqual(countByStatus([{ currentStatus: 'idle' }, { currentStatus: 'idle' }, { currentStatus: 'on_trip' }]),
    { idle: 2, on_trip: 1, maintenance: 0, offline: 0, retired: 0 });
  assert.strictEqual(countByStatus([{ currentStatus: 'weird' }]).weird, 1);
});

test('unreadCount and matches', () => {
  assert.strictEqual(unreadCount([{ isRead: false }, { isRead: true }, { isRead: false }]), 2);
  assert.ok(matches('', 'anything'));
  assert.ok(matches('  bus ', 'Bus #01'));
  assert.ok(matches('rahim', null, 'Rahim Uddin'));
  assert.ok(!matches('van', 'Bus #01', null));
});

const row = { vehicleId: 'v1', vehicleNumber: 'Bus #01', lat: 22.8, lng: 89.5, speed: 5, recordedAt: '2026-10-16T08:00:00.000Z' };

test('fromPositionRow converts the server row', () => {
  assert.deepStrictEqual(fromPositionRow(row), { vehicleId: 'v1', vehicleNumber: 'Bus #01', lat: 22.8, lng: 89.5, speed: 5, at: Date.parse('2026-10-16T08:00:00.000Z') });
});

test('applyLocation updates a vehicle, adds unknown ones and ignores older fixes', () => {
  const t0 = Date.parse('2026-10-16T08:00:00.000Z');
  const start = { v1: fromPositionRow(row) };
  const moved = applyLocation(start, { vehicleId: 'v1', latitude: 22.9, longitude: 89.6, speed: 7, timestamp: '2026-10-16T08:00:05.000Z' }, t0);
  assert.strictEqual(moved.v1.lat, 22.9);
  assert.strictEqual(moved.v1.vehicleNumber, 'Bus #01'); // kept from the earlier row
  assert.notStrictEqual(moved, start); // immutable

  const stale = applyLocation(moved, { vehicleId: 'v1', latitude: 1, longitude: 1, timestamp: '2026-10-16T07:59:00.000Z' }, t0);
  assert.strictEqual(stale, moved); // older fix: unchanged

  const added = applyLocation(moved, { vehicleId: 'v2', vehicleNumber: 'Van', latitude: 2, longitude: 3 }, t0);
  assert.strictEqual(added.v2.at, t0);
  assert.strictEqual(Object.keys(added).length, 2);
});

test('isStale and positionsToGeoJson flag fixes older than 30 s and use [lng, lat]', () => {
  const now = Date.parse('2026-10-16T08:01:00.000Z');
  const fresh = { ...fromPositionRow(row), at: now - 5_000 };
  const old = { ...fromPositionRow({ ...row, vehicleId: 'v2' }), at: now - 31_000 };
  assert.ok(!isStale(fresh, now));
  assert.ok(isStale(old, now));
  const geo = positionsToGeoJson({ v1: fresh, v2: old }, now);
  assert.strictEqual(geo.type, 'FeatureCollection');
  assert.deepStrictEqual(geo.features[0].geometry.coordinates, [89.5, 22.8]);
  assert.deepStrictEqual(geo.features.map((f) => f.properties.stale), [false, true]);
});

test('nearestPos picks the closest vehicle inside the radius, else null', () => {
  const m = {
    a: { vehicleId: 'a', vehicleNumber: 'A', lat: 22.8000, lng: 89.5000, speed: null, at: 0 },
    b: { vehicleId: 'b', vehicleNumber: 'B', lat: 22.8100, lng: 89.5000, speed: null, at: 0 }, // ~1.1 km away
  };
  assert.strictEqual(nearestPos(m, 22.8001, 89.5001)?.vehicleId, 'a');
  assert.strictEqual(nearestPos(m, 22.8099, 89.5000)?.vehicleId, 'b');
  assert.strictEqual(nearestPos(m, 22.8050, 89.5000), null); // ~550 m from both
});
