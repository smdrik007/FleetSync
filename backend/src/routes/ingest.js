'use strict';

/**
 * Device ingest: trackers report here with their own credentials, not a user login.
 * POST /api/v1/ingest/json      microcontrollers; one point or an array; Authorization: Bearer <device key>
 * GET|POST /api/v1/ingest/osmand  Traccar Client / OsmAnd style query params; ?key=<device key>
 * POST /api/v1/ingest/traccar   Traccar gateway forwarding (bands, GT06, ...); X-Forward-Secret header
 */

const crypto = require('crypto');
const router = require('express').Router();
const prisma = require('../db/client');
const { bad, wrap } = require('../lib/http');
const { hashKey } = require('../lib/deviceKey');
const { normalizePoint, prepareBatch, recordPositions, recordAssetPositions } = require('../lib/positions');
const { emitLocationUpdate, emitAssetLocation } = require('../ws/server');
const { evaluate } = require('../lib/alerts');

const MAX_REQUESTS_PER_MIN = 120;
const hits = new Map();   // deviceId -> { start, n }. shortcut: per-process counter, move to Redis when running several instances

function throttle(deviceId) {
  const now = Date.now();
  const h = hits.get(deviceId);
  if (!h || now - h.start > 60_000) { hits.set(deviceId, { start: now, n: 1 }); return; }
  if (++h.n > MAX_REQUESTS_PER_MIN) throw bad(429, 'TOO_MANY_REQUESTS', 'This device is sending too fast.');
}
setInterval(() => { const cut = Date.now() - 60_000; for (const [k, h] of hits) if (h.start < cut) hits.delete(k); }, 60_000).unref();

const deviceInclude = { vehicle: { select: { vehicleNumber: true } }, asset: true };

async function deviceByKey(req) {
  const header = req.headers.authorization || '';
  const key = header.startsWith('Bearer ') ? header.slice(7) : req.query.key;
  const d = key ? await prisma.device.findUnique({ where: { apiKeyHash: hashKey(key) }, include: deviceInclude }) : null;
  if (!d) throw bad(401, 'INVALID_DEVICE_KEY', 'Device key is missing or wrong.');
  return d;
}

/** Gateway hop: constant-time compare of the shared secret, then the device must be registered by IMEI. */
async function deviceByGateway(req, imei) {
  const secret = process.env.TRACCAR_FORWARD_SECRET;
  if (!secret) throw bad(503, 'GATEWAY_DISABLED', 'TRACCAR_FORWARD_SECRET is not set.');
  const given = Buffer.from(String(req.headers['x-forward-secret'] || ''));
  const want = Buffer.from(secret);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw bad(401, 'INVALID_GATEWAY_SECRET', 'Gateway secret is wrong.');
  const d = imei ? await prisma.device.findUnique({ where: { imei: String(imei) }, include: deviceInclude }) : null;
  if (!d) throw bad(404, 'UNKNOWN_DEVICE', 'No device is registered with this identifier.');
  return d;
}

/** Store the points, attach them to the vehicle's running trip, push the newest one to live screens. */
async function store(device, points) {
  if (device.status !== 'active') throw bad(403, 'DEVICE_INACTIVE', `Device is ${device.status}.`);
  throttle(device.id);
  const batch = prepareBatch(points);
  if (device.assetId) return storeForAsset(device, batch);
  const trip = await prisma.trip.findFirst({ where: { vehicleId: device.vehicleId, status: 'in_progress' }, select: { id: true } });
  const stored = await recordPositions(device, trip?.id ?? null, batch);
  const n = batch[batch.length - 1];
  emitLocationUpdate({
    data: {
      vehicleId: device.vehicleId, vehicleNumber: device.vehicle.vehicleNumber, tripId: trip?.id ?? null,
      latitude: n.lat, longitude: n.lng, accuracy: n.accuracy, heading: n.heading, speed: n.speed,
      batteryPct: n.battery, timestamp: n.ts.toISOString(), institutionId: device.institutionId,
    },
    vehicleId: device.vehicleId, institutionId: device.institutionId,
  });
  return { received: batch.length, stored };
}

/** A tracked person: stored only with recorded consent and while not paused; alerts run on the newest point. */
async function storeForAsset(device, batch) {
  const asset = device.asset;
  if (!asset.consentAt) throw bad(403, 'CONSENT_REQUIRED', 'Record consent for this person before tracking starts.');
  if (asset.trackingPaused) throw bad(403, 'TRACKING_PAUSED', 'Tracking is paused for this person.');
  const { stored, prev } = await recordAssetPositions(device, asset.id, batch);
  const n = batch[batch.length - 1];
  try { await evaluate(asset, prev, { lat: n.lat, lng: n.lng, battery: n.battery, attrs: n.attrs }); }
  catch (err) { console.error('[alerts]', err.message); }   // a failed alert must not make the device resend
  emitAssetLocation({
    data: { assetId: asset.id, name: asset.name, latitude: n.lat, longitude: n.lng, accuracy: n.accuracy, speed: n.speed,
            batteryPct: n.battery, sos: !!n.attrs?.sos, timestamp: n.ts.toISOString() },
    assetId: asset.id, institutionId: device.institutionId,
  });
  return { received: batch.length, stored };
}

const sameDevice = (device, id) => {
  if (id !== undefined && id !== null && String(id) !== device.imei) throw bad(401, 'DEVICE_MISMATCH', 'The id does not belong to this key.');
};

router.post('/json', wrap(async (req, res) => {
  const device = await deviceByKey(req);
  const items = Array.isArray(req.body) ? req.body : [req.body];
  if (!items.length) throw bad(422, 'MISSING_FIELDS', 'Send at least one point.');
  for (const p of items) sameDevice(device, p?.imei);
  const points = items.map((p) => normalizePoint(p || {}));
  res.json({ success: true, data: await store(device, points) });
}));

// Traccar Client sends form or query data; OsmAnd speed is in knots.
router.all('/osmand', require('express').urlencoded({ extended: false }), wrap(async (req, res) => {
  const device = await deviceByKey(req);
  const q = { ...req.query, ...req.body };
  sameDevice(device, q.id ?? q.deviceid);
  const point = normalizePoint({
    ts: q.timestamp ?? new Date().toISOString(), lat: q.lat, lng: q.lon, speed: q.speed,
    heading: q.bearing ?? q.heading, accuracy: q.accuracy, battery: q.batt,
  }, { speedKnots: true });
  res.json({ success: true, data: await store(device, [point]) });
}));

// shortcut: payload shape ({ position, device } with knots speed and attributes) is from Traccar's docs, not a captured payload. Verify against a real forward before relying on it (plan phase 3).
router.post('/traccar', wrap(async (req, res) => {
  const pos = req.body?.position || req.body || {};
  const imei = req.body?.device?.uniqueId ?? pos.deviceUniqueId ?? pos.uniqueId;
  const device = await deviceByGateway(req, imei);
  const a = pos.attributes || {};
  const point = normalizePoint({
    ts: pos.fixTime ?? pos.deviceTime ?? pos.serverTime, lat: pos.latitude, lng: pos.longitude, speed: pos.speed,
    heading: pos.course, accuracy: pos.accuracy, battery: a.batteryLevel ?? a.battery,
    ignition: a.ignition, sos: a.alarm === 'sos',
  }, { speedKnots: true });
  res.json({ success: true, data: await store(device, [point]) });
}));

module.exports = router;
