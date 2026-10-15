/// <reference types="node" />
import assert from 'node:assert';
import test, { mock } from 'node:test';
import { authState } from './api.ts';
import { openSocket } from './ws.ts';

class FakeWS {
  static OPEN = 1;
  static instances: FakeWS[] = [];
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (e: { data: string }) => void;
  constructor(url: string) { this.url = url; FakeWS.instances.push(this); }
  send(s: string) { this.sent.push(s); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
}
const last = () => FakeWS.instances[FakeWS.instances.length - 1];

test.beforeEach(() => {
  globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch; // polling must not hit a real network
  FakeWS.instances = [];
  globalThis.WebSocket = FakeWS as unknown as typeof WebSocket;
  authState.token = 'jwt-abc';
  mock.timers.enable({ apis: ['setTimeout'] });
});
test.afterEach(() => mock.timers.reset());

test('connects with the token, reports status and dispatches events', () => {
  const events: unknown[] = [];
  const status: boolean[] = [];
  openSocket((e, d) => events.push([e, d]), (s) => status.push(s));
  assert.match(last().url, /\/ws\?token=jwt-abc$/);
  last().open();
  last().onmessage?.({ data: JSON.stringify({ event: 'location.update', data: { vehicleId: 'v1' } }) });
  last().onmessage?.({ data: 'not json' }); // must not throw
  assert.deepStrictEqual(status, [true]);
  assert.deepStrictEqual(events, [['location.update', { vehicleId: 'v1' }]]);
});

test('retries once after 1s, then falls back to polling instead of reconnecting forever', () => {
  const s = openSocket(() => {}, () => {});
  last().close();
  mock.timers.tick(999);
  assert.strictEqual(FakeWS.instances.length, 1, 'no reconnect before 1000ms');
  mock.timers.tick(1);
  assert.strictEqual(FakeWS.instances.length, 2, 'reconnect at 1000ms');
  last().close();                    // second failure in a row: server has no WebSocket
  mock.timers.tick(60_000);
  assert.strictEqual(FakeWS.instances.length, 2, 'no further socket attempts');
  s.close();                         // stops the poll interval so the test process can exit
});

test('a socket that opened resets the failure count and backoff', () => {
  openSocket(() => {}, () => {});
  last().close(); mock.timers.tick(1000);
  last().open();
  last().close();
  const n = FakeWS.instances.length;
  mock.timers.tick(1000);
  assert.strictEqual(FakeWS.instances.length, n + 1, 'reconnects after 1s again, not polling');
});

test('close() stops reconnecting', () => {
  const s = openSocket(() => {}, () => {});
  last().open();
  s.close();
  const n = FakeWS.instances.length;
  mock.timers.tick(60_000);
  assert.strictEqual(FakeWS.instances.length, n);
});

test('send() only writes while the socket is open', () => {
  const s = openSocket(() => {}, () => {});
  s.send({ action: 'watch_vehicle', vehicleId: 'v1' });
  assert.deepStrictEqual(last().sent, [], 'still connecting: dropped, caller re-sends on status');
  last().open();
  s.send({ action: 'watch_vehicle', vehicleId: 'v1' });
  assert.deepStrictEqual(last().sent, ['{"action":"watch_vehicle","vehicleId":"v1"}']);
});

test('does not connect without a session token', () => {
  authState.token = null;
  openSocket(() => {}, () => {});
  assert.strictEqual(FakeWS.instances.length, 0);
});
