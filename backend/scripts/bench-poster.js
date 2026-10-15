'use strict';
/**
 * Poster benchmark: measures real latencies against a running API.
 *   API_BASE=http://localhost:3100/api/v1 node scripts/bench-poster.js
 * Uses the seeded demo accounts and Rahim's seeded in-progress trip.
 */
const WebSocket = require('ws');
const fs = require('fs');

const API = process.env.API_BASE || 'http://localhost:3000/api/v1';
const WS = API.replace(/^http/, 'ws').replace(/\/api\/v1$/, '/ws');
const KU = '00000000-0000-4000-a000-000000000001';
const VEHICLE = '00000000-0000-4000-f000-000000000001';

const now = () => Number(process.hrtime.bigint()) / 1e6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: +s[0].toFixed(1), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1), mean: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(1) };
};

async function call(token, method, path, body) {
  const t = now();
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { ms: now() - t, status: res.status, json };
}
const login = async (email) => (await call(null, 'POST', '/auth/login', { institutionId: KU, email, password: 'demo1234' })).json.data.token;

async function timed(token, path, n) {
  const out = [];
  for (let i = 0; i < n; i++) { const r = await call(token, 'GET', path); if (r.status !== 200) throw new Error(`${path} ${r.status}`); out.push(r.ms); }
  return stats(out);
}

(async () => {
  const R = {};
  // warm-up (DB connection pool)
  await call(null, 'POST', '/auth/login', { institutionId: KU, email: 'authority@ku.edu.bd', password: 'demo1234' });

  const loginMs = [];
  for (let i = 0; i < 15; i++) loginMs.push((await call(null, 'POST', '/auth/login', { institutionId: KU, email: 'passenger@ku.edu.bd', password: 'demo1234' })).ms);
  R.login = stats(loginMs);

  const auth = await login('authority@ku.edu.bd');
  const pass = await login('passenger@ku.edu.bd');
  const drv = await login('rahim@ku.edu.bd');
  const idle = await login('karim@ku.edu.bd');

  R.endpoints = {
    'Dashboard summary': await timed(auth, '/fleet/dashboard/summary', 25),
    'Vehicle list': await timed(auth, '/fleet/vehicles', 25),
    'Live positions': await timed(auth, '/fleet/positions', 25),
    'Passenger vehicles': await timed(pass, '/passenger/vehicles', 25),
    'Driver assignment': await timed(drv, '/driver/me/assignment', 25),
  };

  // End-to-end GPS sync: driver POST -> passenger WebSocket 'location.update'
  const ws = new WebSocket(`${WS}?token=${pass}`);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(JSON.stringify({ action: 'watch_vehicle', vehicleId: VEHICLE }));
  await new Promise((res) => ws.on('message', (m) => { if (JSON.parse(m).event === 'watching') res(); }));

  const pending = new Map();
  ws.on('message', (m) => {
    const msg = JSON.parse(m);
    if (msg.event !== 'location.update') return;
    const key = String(msg.data.latitude ?? msg.data.lat);
    const t0 = pending.get(key);
    if (t0 !== undefined) { pending.get('_done').push(now() - t0); pending.delete(key); }
  });
  pending.set('_done', []);
  const postMs = [];
  const N = 40;
  for (let i = 0; i < N; i++) {
    // small loop around Khulna University campus
    const lat = +(22.8030 + 0.0004 * Math.sin(i / 6)).toFixed(6) + i * 1e-6;
    const lng = +(89.5340 + 0.0004 * Math.cos(i / 6)).toFixed(6);
    pending.set(String(lat), now());
    const r = await call(drv, 'POST', '/driver/trips/current/location', { latitude: lat, longitude: lng, speed: 18, heading: 90, accuracy: 8, timestamp: new Date().toISOString() });
    if (r.status !== 200) throw new Error('location ' + r.status + ' ' + JSON.stringify(r.json));
    postMs.push(r.ms);
    await sleep(250);
  }
  await sleep(1500);
  const e2e = pending.get('_done');
  R.gpsPost = stats(postMs);
  R.gpsEndToEnd = stats(e2e);
  R.gpsDelivered = { sent: N, received: e2e.length };
  ws.close();

  // Privacy: off-duty driver (no in-progress trip) cannot publish GPS
  let blocked = 0;
  for (let i = 0; i < 20; i++) {
    const r = await call(idle, 'POST', '/driver/trips/current/location', { latitude: 22.8, longitude: 89.53, timestamp: new Date().toISOString() });
    if (r.status === 403 || r.status === 404) blocked++;
  }
  R.offDutyBlocked = { attempts: 20, blocked };

  // Concurrency: K simultaneous passengers polling the vehicle list, 7 rounds each (median reported)
  R.concurrency = {};
  for (const k of [1, 10, 25, 50, 100]) {
    const walls = [], means = [];
    let ok = 0;
    for (let round = 0; round < 7; round++) {
      const t = now();
      const rs = await Promise.all(Array.from({ length: k }, () => call(pass, 'GET', '/passenger/vehicles')));
      walls.push(now() - t);
      means.push(rs.reduce((a, r) => a + r.ms, 0) / k);
      ok += rs.filter((r) => r.status === 200).length;
      await sleep(200);
    }
    const wall = stats(walls).p50, mean = stats(means).p50;
    R.concurrency[k] = { requests: k * 7, ok, wallMs: wall, meanMs: mean, rps: +((k / wall) * 1000).toFixed(0) };
  }

  R.measuredAt = new Date().toISOString();
  fs.writeFileSync(process.env.OUT || 'bench-results.json', JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
