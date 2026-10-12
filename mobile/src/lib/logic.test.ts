import assert from 'node:assert';
import test from 'node:test';
import {
  type Row, type TripState,
  flushAction, flushQueue, formatElapsed, haversine, milestoneIndex, parseRoute, reconcile, startWhenForeground, timeAgo, toPoint,
} from './logic.ts';

// ─── route parsing / stepper ──────────────────────────────────────────

test('parseRoute splits on →, -->, -> and commas and drops blanks', () => {
  assert.deepStrictEqual(parseRoute('Sonadanga → Shibbari --> KU Gate -> Campus, Depot'), ['Sonadanga', 'Shibbari', 'KU Gate', 'Campus', 'Depot']);
  assert.deepStrictEqual(parseRoute(' A,, B '), ['A', 'B']);
  assert.deepStrictEqual(parseRoute('   '), []);
  assert.deepStrictEqual(parseRoute(null), []);
});

test('haversine: zero for the same point, about 111 km per degree of latitude', () => {
  assert.strictEqual(haversine([22.8, 89.5], [22.8, 89.5]), 0);
  assert.ok(Math.abs(haversine([0, 0], [1, 0]) - 111195) < 200);
});

const stops = [
  { name: 'A', latitude: 22.80, longitude: 89.53 },
  { name: 'B', latitude: 22.85, longitude: 89.52 },
  { name: 'C', latitude: 22.90, longitude: 89.50 },
];

test('milestoneIndex: -1 off trip, first stop with no position, nearest stop otherwise', () => {
  assert.strictEqual(milestoneIndex(stops, { latitude: 22.9, longitude: 89.5 }, false), -1);
  assert.strictEqual(milestoneIndex(stops, null, true), 0);
  assert.strictEqual(milestoneIndex(stops, { latitude: null, longitude: null }, true), 0);
  assert.strictEqual(milestoneIndex(stops, { latitude: 22.899, longitude: 89.501 }, true), 2);
  assert.strictEqual(milestoneIndex([], { latitude: 22.9, longitude: 89.5 }, true), -1);
});

test('timeAgo switches from seconds to minutes and pluralises', () => {
  const now = 1_000_000;
  assert.strictEqual(timeAgo(now - 45_000, now), '45s ago');
  assert.strictEqual(timeAgo(now - 60_000, now), '1 minute ago');
  assert.strictEqual(timeAgo(now - 190_000, now), '3 minutes ago');
});

test('formatElapsed pads minutes and seconds and shows hours only when needed', () => {
  assert.strictEqual(formatElapsed(0), '00:00');
  assert.strictEqual(formatElapsed(307_000), '05:07');
  assert.strictEqual(formatElapsed(3_729_000), '1:02:09');
  assert.strictEqual(formatElapsed(-5000), '00:00', 'a phone clock slightly behind the server must not show a negative time');
});

// ─── GPS point mapping ────────────────────────────────────────────────

test('toPoint maps unknown (-1) speed/heading to null and uses the fix time', () => {
  const p = toPoint({ coords: { latitude: 22.86, longitude: 89.52, accuracy: 8, speed: -1, heading: -1 }, timestamp: Date.UTC(2026, 9, 12, 9, 0, 0) });
  assert.deepStrictEqual(p, { latitude: 22.86, longitude: 89.52, accuracy: 8, speed: null, heading: null, timestamp: '2026-10-12T09:00:00.000Z' });
  assert.strictEqual(toPoint({ coords: { latitude: 1, longitude: 2, accuracy: null, speed: 0, heading: 90 }, timestamp: 0 }).speed, 0, 'a stationary vehicle reports 0, not null');
});

// ─── flush policy ─────────────────────────────────────────────────────

test('flushAction: what each server answer means for a queued point', () => {
  assert.strictEqual(flushAction(undefined), 'retry');
  assert.strictEqual(flushAction(500), 'retry');
  assert.strictEqual(flushAction(503), 'retry');
  assert.strictEqual(flushAction(401), 'unauthorized');
  assert.strictEqual(flushAction(403, 'TRIP_NOT_ACTIVE'), 'trip-ended');
  assert.strictEqual(flushAction(404, 'TRIP_NOT_FOUND'), 'trip-ended');
  assert.strictEqual(flushAction(400, 'INVALID_COORDINATES'), 'drop');
  assert.strictEqual(flushAction(403, 'FORBIDDEN'), 'drop');
});

/** In-memory queue with a scripted server. */
function harness(rows: Row[], answer: (row: Row) => { status?: number; code?: string } | null) {
  const queue = [...rows];
  const delivered: number[] = [];
  return {
    queue, delivered,
    deps: {
      peek: async (n: number) => queue.slice(0, n),
      remove: async (ids: number[]) => { for (const id of ids) queue.splice(queue.findIndex((r) => r.id === id), 1); },
      removeTrip: async (tripId: string) => { for (let i = queue.length - 1; i >= 0; i--) if (queue[i].trip_id === tripId) queue.splice(i, 1); },
      post: async (_trip: string, body: string) => {
        const row = rows.find((r) => r.body === body) as Row;
        const err = answer(row);
        if (err) throw Object.assign(new Error('x'), err);
        delivered.push(row.id);
      },
    },
  };
}
const mk = (n: number, trip = 'T1'): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, trip_id: trip, body: `p${i + 1}${trip}` }));

test('flushQueue delivers every point oldest-first and drains', async () => {
  const h = harness(mk(120), () => null);
  assert.strictEqual(await flushQueue(h.deps, 50), 'drained');
  assert.deepStrictEqual(h.delivered, Array.from({ length: 120 }, (_, i) => i + 1));
  assert.strictEqual(h.queue.length, 0);
});

test('flushQueue stops at the first network failure and keeps order for the retry', async () => {
  let up = true;
  const h = harness(mk(6), (r) => (r.id === 4 && up ? { status: undefined } : null));
  assert.strictEqual(await flushQueue(h.deps), 'retry');
  assert.deepStrictEqual(h.delivered, [1, 2, 3]);
  assert.deepStrictEqual(h.queue.map((r) => r.id), [4, 5, 6], 'undelivered points stay queued, in order');
  up = false;
  assert.strictEqual(await flushQueue(h.deps), 'drained');
  assert.deepStrictEqual(h.delivered, [1, 2, 3, 4, 5, 6]);
});

test('flushQueue keeps the queue on 401 and tells the caller to re-login', async () => {
  const h = harness(mk(3), () => ({ status: 401, code: 'INVALID_TOKEN' }));
  assert.strictEqual(await flushQueue(h.deps), 'unauthorized');
  assert.strictEqual(h.queue.length, 3);
});

test('flushQueue drops a point the server rejects (400) and carries on', async () => {
  const h = harness(mk(4), (r) => (r.id === 2 ? { status: 400, code: 'INVALID_COORDINATES' } : null));
  assert.strictEqual(await flushQueue(h.deps), 'drained');
  assert.deepStrictEqual(h.delivered, [1, 3, 4]);
  assert.strictEqual(h.queue.length, 0);
});

test('flushQueue purges a trip the server says is over, and only that trip', async () => {
  const rows = [...mk(2, 'OLD'), ...mk(2, 'NEW').map((r) => ({ ...r, id: r.id + 10 }))];
  const h = harness(rows, (r) => (r.trip_id === 'OLD' ? { status: 403, code: 'TRIP_NOT_ACTIVE' } : null));
  assert.strictEqual(await flushQueue(h.deps), 'trip-ended');
  assert.deepStrictEqual(h.queue.map((r) => r.trip_id), ['NEW', 'NEW']);
  assert.strictEqual(await flushQueue(h.deps), 'drained');
  assert.deepStrictEqual(h.delivered, [11, 12]);
});

// ─── starting the foreground service ──────────────────────────────────

const FGS_ERROR = "Call to function 'ExpoLocation.startLocationUpdatesAsync' has been rejected. → Caused by: Couldn't start the foreground service. Foreground service cannot be started when the application is in the background";

function startHarness(opts: { foreground: (calls: number) => boolean; failures?: Error[] }) {
  const sleeps: number[] = [];
  let starts = 0;
  let checks = 0;
  const failures = [...(opts.failures ?? [])];
  return {
    sleeps,
    starts: () => starts,
    run: (cfg?: Parameters<typeof startWhenForeground>[3]) =>
      startWhenForeground(
        async () => { starts++; const f = failures.shift(); if (f) throw f; },
        () => opts.foreground(checks++),
        async (ms) => { sleeps.push(ms); },
        cfg,
      ),
  };
}

test('startWhenForeground starts at once when the app is on screen', async () => {
  const h = startHarness({ foreground: () => true });
  await h.run();
  assert.strictEqual(h.starts(), 1);
  assert.deepStrictEqual(h.sleeps, []);
});

test('startWhenForeground waits for the app to come on screen, then starts', async () => {
  const h = startHarness({ foreground: (n) => n >= 3 });
  await h.run();
  assert.strictEqual(h.starts(), 1);
  assert.strictEqual(h.sleeps.length, 3);
});

test('startWhenForeground gives up with a clear message if the app never comes on screen', async () => {
  const h = startHarness({ foreground: () => false });
  await assert.rejects(h.run({ waitMs: 1000 }), /on screen/);
  assert.strictEqual(h.starts(), 0, 'must not even try from the background');
});

test('startWhenForeground retries the foreground-service refusal and then succeeds', async () => {
  const h = startHarness({ foreground: () => true, failures: [new Error(FGS_ERROR), new Error(FGS_ERROR)] });
  await h.run();
  assert.strictEqual(h.starts(), 3);
  assert.deepStrictEqual(h.sleeps, [700, 700]);
});

test('startWhenForeground turns a persistent refusal into the clear message', async () => {
  const h = startHarness({ foreground: () => true, failures: Array.from({ length: 10 }, () => new Error(FGS_ERROR)) });
  await assert.rejects(h.run({ retries: 2 }), (e: Error) => /on screen/.test(e.message) && !/Expo|rejected/.test(e.message));
  assert.strictEqual(h.starts(), 3);
});

test('startWhenForeground reports other errors immediately without retrying', async () => {
  const h = startHarness({ foreground: () => true, failures: [new Error('Missing background location permission')] });
  await assert.rejects(h.run(), /Missing background location permission/);
  assert.strictEqual(h.starts(), 1);
});

// ─── reconcile (FR-DRV-03) ────────────────────────────────────────────

const trip = (tripId: string, ending = false): TripState => ({ tripId, ending });

test('reconcile: tracking runs only while the server says a trip is active', () => {
  assert.strictEqual(reconcile(null, null, false), 'none', 'off duty, nothing running');
  assert.strictEqual(reconcile(null, null, true), 'stop', 'updates running with no trip must be stopped');
  assert.strictEqual(reconcile(null, trip('T1'), false), 'stop', 'trip ended elsewhere');
  assert.strictEqual(reconcile('T1', null, false), 'start', 'trip started from the web portal or after reinstall');
  assert.strictEqual(reconcile('T1', trip('T1'), true), 'none', 'already tracking this trip');
  assert.strictEqual(reconcile('T1', trip('T1'), false), 'start', 'service died, resume');
  assert.strictEqual(reconcile('T2', trip('T1'), true), 'start', 'a different trip replaces the old one');
});

test('reconcile: a trip being ended is never restarted', () => {
  assert.strictEqual(reconcile('T1', trip('T1', true), false), 'pending-end');
  assert.strictEqual(reconcile('T1', trip('T1', true), true), 'pending-end');
  assert.strictEqual(reconcile(null, trip('T1', true), false), 'stop', 'server already ended it; just clear local state');
});
