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

test('reconnects with doubling backoff, capped at 15s, and resets after a successful open', () => {
  openSocket(() => {}, () => {});
  const wait = (ms: number) => { const before = FakeWS.instances.length; mock.timers.tick(ms - 1); assert.strictEqual(FakeWS.instances.length, before, `no reconnect before ${ms}ms`); mock.timers.tick(1); assert.strictEqual(FakeWS.instances.length, before + 1, `reconnect at ${ms}ms`); };
  last().close(); wait(1000);
  last().close(); wait(2000);
  last().close(); wait(4000);
  last().close(); wait(8000);
  last().close(); wait(15000);
  last().close(); wait(15000);
  last().open();                     // connected again: backoff starts over
  last().close(); wait(1000);
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
