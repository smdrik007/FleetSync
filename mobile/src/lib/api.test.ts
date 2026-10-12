/// <reference types="node" />
import assert from 'node:assert';
import test from 'node:test';
import { ApiError, api, authState, normalizeServerUrl, server } from './api.ts';

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
const reply = (status: number, body: unknown) => async (url: string | URL | Request, init?: RequestInit) => {
  calls.push({ url: String(url), init: init ?? {} });
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
};

test.beforeEach(() => {
  calls.length = 0;
  authState.token = null;
  authState.onExpired = () => {};
});

test('unwraps data and sends the Bearer token', async () => {
  globalThis.fetch = reply(200, { success: true, data: { id: 1 } }) as typeof fetch;
  authState.token = 'jwt-123';
  assert.deepStrictEqual(await api.get('/driver/me/assignment'), { id: 1 });
  assert.match(calls[0].url, /\/api\/v1\/driver\/me\/assignment$/);
  assert.strictEqual((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer jwt-123');
});

test('POST sends a JSON body and no Authorization header when signed out', async () => {
  globalThis.fetch = reply(200, { success: true, data: {} }) as typeof fetch;
  await api.post('/auth/login', { email: 'a@b.c' });
  assert.strictEqual(calls[0].init.body, '{"email":"a@b.c"}');
  assert.ok(!('Authorization' in (calls[0].init.headers as object)));
});

test('an error envelope becomes an ApiError with code and status', async () => {
  globalThis.fetch = reply(409, { success: false, error: { code: 'TRIP_ALREADY_ACTIVE', message: 'Already running.' } }) as typeof fetch;
  await assert.rejects(api.post('/driver/trips/start'), (e: ApiError) => {
    assert.ok(e instanceof ApiError);
    assert.deepStrictEqual([e.code, e.status, e.message], ['TRIP_ALREADY_ACTIVE', 409, 'Already running.']);
    return true;
  });
});

test('401 expires the session, except for the login call', async () => {
  let expired = 0;
  authState.onExpired = () => { expired++; };
  globalThis.fetch = reply(401, { success: false, error: { code: 'INVALID_TOKEN', message: 'expired' } }) as typeof fetch;
  await assert.rejects(api.get('/auth/me'));
  assert.strictEqual(expired, 1);
  await assert.rejects(api.post('/auth/login', {}));
  assert.strictEqual(expired, 1, 'wrong password must not sign anyone out');
});

test('normalizeServerUrl accepts https and LAN http, and rejects everything else', () => {
  assert.strictEqual(normalizeServerUrl(' https://Abc-Def.trycloudflare.com/ '), 'https://abc-def.trycloudflare.com');
  assert.strictEqual(normalizeServerUrl('https://api.example.com:8443'), 'https://api.example.com:8443');
  assert.strictEqual(normalizeServerUrl('http://192.168.1.20:3000'), 'http://192.168.1.20:3000');
  assert.strictEqual(normalizeServerUrl('http://10.0.2.2:3000'), 'http://10.0.2.2:3000');
  assert.strictEqual(normalizeServerUrl('http://api.example.com'), null, 'plain http over the internet is refused');
  assert.strictEqual(normalizeServerUrl('api.example.com'), null, 'a scheme is required');
  assert.strictEqual(normalizeServerUrl('https://api.example.com/path'), null, 'paths are not part of a server address');
  assert.strictEqual(normalizeServerUrl('ftp://api.example.com'), null);
  assert.strictEqual(normalizeServerUrl('https://'), null);
});

test('requests go to the current server address', async () => {
  const before = server.origin;
  try {
    server.origin = 'https://example-tunnel.trycloudflare.com';
    globalThis.fetch = reply(200, { success: true, data: {} }) as typeof fetch;
    await api.get('/institutions');
    assert.strictEqual(calls[0].url, 'https://example-tunnel.trycloudflare.com/api/v1/institutions');
  } finally {
    server.origin = before;
  }
});

test('an unreachable server is a NETWORK error', async () => {
  globalThis.fetch = (async () => { throw new TypeError('Network request failed'); }) as typeof fetch;
  await assert.rejects(api.get('/institutions'), (e: ApiError) => e.code === 'NETWORK');
});

test('a non-JSON body is a generic error, not a crash', async () => {
  globalThis.fetch = reply(502, '<html>Bad gateway</html>') as typeof fetch;
  await assert.rejects(api.get('/institutions'), (e: ApiError) => e.status === 502 && /502/.test(e.message));
});
