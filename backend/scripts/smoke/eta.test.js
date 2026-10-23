'use strict';
// Next stop and arrival time: pure maths, no server needed.
const test = require('node:test');
const assert = require('node:assert');
const { nextStopEta, averageSpeedKmh, metres } = require('../../src/lib/eta');

// Three stops in a line going north, about 1.1 km apart.
const stops = [
  { name: 'A', latitude: 22.80, longitude: 89.50 },
  { name: 'B', latitude: 22.81, longitude: 89.50 },
  { name: 'C', latitude: 22.82, longitude: 89.50 },
];
const at = (lat, lng = 89.50) => ({ lat, lng });

test('between two stops: the next one is ahead, with a sensible time', () => {
  const r = nextStopEta(stops, at(22.803), 20);
  assert.strictEqual(r.next.name, 'B');
  assert.strictEqual(r.next.order, 2);
  assert.strictEqual(r.atStop, null);
  const straight = metres(at(22.803), at(22.81));
  assert.ok(Math.abs(r.next.distanceM - straight * 1.3) < 2, 'road factor applied');
  assert.strictEqual(r.next.etaMinutes, Math.ceil(r.next.distanceM / 1000 / 20 * 60));
  assert.strictEqual(r.speedMeasured, true);
});

test('after passing a stop the next stop moves on', () => {
  assert.strictEqual(nextStopEta(stops, at(22.8105), 20).next.name, 'C');
  assert.strictEqual(nextStopEta(stops, at(22.8005), 20).next.name, 'B');
});

test('standing at a stop: reports it and looks to the next', () => {
  const r = nextStopEta(stops, at(22.8101), 20);   // about 11 m from B
  assert.strictEqual(r.atStop, 'B');
  assert.strictEqual(r.next.name, 'C');
});

test('before the first stop the first stop is next; at the last stop there is no next', () => {
  assert.strictEqual(nextStopEta(stops, at(22.795), 20).next.name, 'A');
  const end = nextStopEta(stops, at(22.8199), 20);
  assert.strictEqual(end.atStop, 'C');
  assert.strictEqual(end.next, null);
});

test('past the end of the route there is nothing to say', () => {
  assert.strictEqual(nextStopEta(stops, at(22.83), 20), null);
});

test('speed is clamped, defaulted when unknown, and the time is at least a minute', () => {
  const slow = nextStopEta(stops, at(22.803), 1);      // 1 km/h would give hours
  assert.strictEqual(slow.speedKmh, 8);
  const unknown = nextStopEta(stops, at(22.803), null);
  assert.strictEqual(unknown.speedKmh, 20);
  assert.strictEqual(unknown.speedMeasured, false);
  assert.strictEqual(nextStopEta(stops, at(22.8085), 50).next.etaMinutes, 1);
});

test('too few stops or no position: nothing to compute', () => {
  assert.strictEqual(nextStopEta([stops[0]], at(22.8), 20), null);
  assert.strictEqual(nextStopEta([], at(22.8), 20), null);
  assert.strictEqual(nextStopEta(stops, null, 20), null);
  assert.strictEqual(nextStopEta([{ name: 'x', latitude: null, longitude: null }, stops[1]], at(22.8), 20), null);
});

test('average speed comes from the distance covered over the time spanned', () => {
  const t0 = Date.now();
  // About 555 m north in 60 s is about 33 km/h.
  const fixes = [{ lat: 22.800, lng: 89.5, at: new Date(t0) }, { lat: 22.805, lng: 89.5, at: new Date(t0 + 60000) }];
  const v = averageSpeedKmh(fixes);
  assert.ok(v > 31 && v < 35, `got ${v}`);
  assert.strictEqual(averageSpeedKmh([fixes[0]]), null, 'one fix is not enough');
  assert.strictEqual(averageSpeedKmh([fixes[0], { ...fixes[1], at: new Date(t0 + 10000) }]), null, 'under 30 s is not enough');
  // Order does not matter, and a bus that barely moved is clamped up to 8 km/h.
  const slow = averageSpeedKmh([{ lat: 22.8001, lng: 89.5, at: new Date(t0 + 120000) }, { lat: 22.8, lng: 89.5, at: new Date(t0) }]);
  assert.strictEqual(slow, 8);
});
