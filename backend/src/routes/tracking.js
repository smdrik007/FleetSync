'use strict';

/**
 * Tracking (Authority only): trips, GPS track replay, devices, live positions.
 * GET            /api/v1/fleet/trips            ?status&vehicleId&driverId&from&to
 * GET            /api/v1/fleet/trips/:id
 * GET            /api/v1/fleet/trips/:id/track
 * GET/POST       /api/v1/fleet/devices
 * PUT/DELETE     /api/v1/fleet/devices/:id
 * GET            /api/v1/fleet/positions
 */

const router = require('express').Router();
const prisma = require('../db/client');
const { authenticate } = require('../middleware/auth');
const { bad, assertEnum, isUuid, wrap } = require('../lib/http');
const { tripDistanceKm } = require('../lib/tripDistance');
const { newDeviceKey, renderSetup } = require('../lib/deviceKey');
const { trackingTypeOf } = require('../lib/trackingType');

const AUTH = authenticate('AUTHORITY');

const TRIP_STATUSES   = ['scheduled', 'in_progress', 'completed', 'cancelled'];
const DEVICE_STATUSES = ['active', 'inactive', 'faulty', 'retired'];
const STALE_MS  = 5 * 60 * 1000;
const MAX_POINTS = 2000;

const tripInclude = {
  vehicle: { select: { id: true, vehicleNumber: true, fuelEfficiencyKmpl: true } },
  driver:  { select: { id: true, name: true } },
  route:   { select: { id: true, name: true } },
};
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

/** Tenant's average price per litre from its own fuel logs; null when it has none. Estimates are never stored. */
async function avgFuelPrice(institutionId) {
  const { _sum } = await prisma.fuelLog.aggregate({ where: { institutionId }, _sum: { totalCost: true, volume: true } });
  const litres = Number(_sum.volume || 0);
  return litres > 0 ? Number(_sum.totalCost) / litres : null;
}

const presentTrip = (t, price = null, distanceKm = t.distanceKm === null ? null : Number(t.distanceKm)) => {
  const kmpl = t.vehicle?.fuelEfficiencyKmpl == null ? null : Number(t.vehicle.fuelEfficiencyKmpl);
  const litres = distanceKm !== null && kmpl ? distanceKm / kmpl : null;
  return {
    id: t.id, status: t.status, startedAt: t.startedAt, endedAt: t.endedAt,
    vehicle: t.vehicle && { id: t.vehicle.id, vehicleNumber: t.vehicle.vehicleNumber },
    driver: t.driver, route: t.route || null,
    distanceKm, estFuelLitres: litres === null ? null : round(litres, 2),
    estFuelCost: litres !== null && price !== null ? round(litres * price, 2) : null,
  };
};

async function ownTrip(id, institutionId) {
  const t = isUuid(id) ? await prisma.trip.findFirst({ where: { id, institutionId }, include: tripInclude }) : null;
  if (!t) throw bad(404, 'TRIP_NOT_FOUND', 'Trip not found.');
  return t;
}

/** A people/things institution attaches devices to people, a vehicle institution to vehicles. */
async function assertTargetAllowed(institutionId, toAsset) {
  const people = (await trackingTypeOf(institutionId)) !== 'vehicle';
  if (toAsset !== people) throw bad(403, 'FEATURE_DISABLED', people ? 'This institution tracks people or things, so devices attach to a person.' : 'This institution tracks vehicles, so devices attach to a vehicle.');
}

async function ownAssetId(id, institutionId) {
  const a = isUuid(id) ? await prisma.asset.findFirst({ where: { id, institutionId }, select: { id: true } }) : null;
  if (!a) throw bad(422, 'INVALID_ASSET', 'Person or equipment not found in your institution.');
  return a.id;
}

async function ownVehicleId(id, institutionId) {
  const v = isUuid(id) ? await prisma.vehicle.findFirst({ where: { id, institutionId }, select: { id: true } }) : null;
  if (!v) throw bad(422, 'INVALID_VEHICLE', 'Vehicle not found in your institution.');
  return v.id;
}

function parseDate(value, field) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw bad(422, 'INVALID_DATE', `${field} must be a valid date.`);
  return d;
}

// ── Trips ────────────────────────────────────────────────────────────
router.get('/trips', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const { status, vehicleId, driverId, from, to } = req.query;
  if (status) assertEnum(status, TRIP_STATUSES, 'status');
  const where = { institutionId };
  if (status) where.status = status;
  // Ids from another tenant simply match nothing because institutionId is always part of the filter.
  if (vehicleId) { if (!isUuid(vehicleId)) return res.json({ success: true, data: [] }); where.vehicleId = vehicleId; }
  if (driverId)  { if (!isUuid(driverId))  return res.json({ success: true, data: [] }); where.driverId = driverId; }
  if (from || to) {
    where.startedAt = {};
    if (from) where.startedAt.gte = parseDate(from, 'from');
    if (to)   where.startedAt.lte = parseDate(to, 'to');
  }
  const rows = await prisma.trip.findMany({ where, include: tripInclude, orderBy: { startedAt: 'desc' }, take: 500 });
  const price = await avgFuelPrice(institutionId);
  res.json({ success: true, data: rows.map((t) => presentTrip(t, price)) });
}));

router.get('/trips/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const t = await ownTrip(req.params.id, institutionId);
  const [{ n }] = await prisma.$queryRaw`SELECT count(*)::int AS n FROM gps_logs WHERE trip_id = ${t.id}::uuid AND institution_id = ${institutionId}::uuid`;
  const durationMinutes = t.endedAt ? Math.round((t.endedAt - t.startedAt) / 60000) : null;
  // Completed trips store it; a trip still running (or not backfilled yet) is measured live.
  const distanceKm = t.distanceKm === null ? await tripDistanceKm(t.id, institutionId) : Number(t.distanceKm);
  res.json({ success: true, data: { ...presentTrip(t, await avgFuelPrice(institutionId), distanceKm), pointCount: n, durationMinutes } });
}));

router.get('/trips/:id/track', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const t = await ownTrip(req.params.id, institutionId);
  const [{ n }] = await prisma.$queryRaw`SELECT count(*)::int AS n FROM gps_logs WHERE trip_id = ${t.id}::uuid AND institution_id = ${institutionId}::uuid`;
  if (n === 0) return res.json({ success: true, data: [] });
  const step = Math.max(1, Math.ceil(n / MAX_POINTS));
  const rows = await prisma.$queryRaw`
    SELECT lat, lng, speed, heading, recorded_at FROM (
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, speed, heading, recorded_at,
             row_number() OVER (ORDER BY recorded_at, id) AS rn
      FROM gps_logs WHERE trip_id = ${t.id}::uuid AND institution_id = ${institutionId}::uuid
    ) p WHERE (p.rn - 1) % ${step}::int = 0 ORDER BY recorded_at`;
  res.json({ success: true, data: rows.map((r) => ({ lat: r.lat, lng: r.lng, speed: r.speed, heading: r.heading, recordedAt: r.recorded_at })) });
}));

// ── Devices ──────────────────────────────────────────────────────────
// A band that reports every 10 minutes is not offline after 5: allow three missed reports.
const presentDevice = (d) => ({
  id: d.id, vehicle: d.vehicle ?? null, asset: d.asset ?? null, deviceType: d.deviceType, imei: d.imei, simIccid: d.simIccid,
  firmwareVersion: d.firmwareVersion, status: d.status, installedAt: d.installedAt, lastSeenAt: d.lastSeenAt,
  reportingIntervalS: d.reportingIntervalS, batteryPct: d.lastBatteryPct, hasKey: !!d.apiKeyHash,
  isOnline: !!d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < Math.max(STALE_MS, 3000 * (d.reportingIntervalS || 0)),
});

const serverUrl = (req) => `${req.protocol}://${req.get('host')}`;

/** Setup text for a device, or null for legacy free-text types. The key is only known right after it is made. */
async function setupGuide(req, device, key) {
  const t = await prisma.deviceType.findUnique({ where: { code: device.deviceType } });
  return t && renderSetup(t.setupTemplate, { server: serverUrl(req), key: key || '<device key>', imei: device.imei });
}

router.get('/device-types', AUTH, wrap(async (_req, res) => {
  const rows = await prisma.deviceType.findMany({ orderBy: { name: 'asc' } });
  res.json({ success: true, data: rows.map((t) => ({ code: t.code, name: t.name, family: t.family, adapter: t.adapter, defaultIntervalS: t.defaultIntervalS, capabilities: t.capabilities })) });
}));
const deviceInclude = { vehicle: { select: { id: true, vehicleNumber: true } }, asset: { select: { id: true, name: true } } };

async function ownDevice(id, institutionId) {
  const d = isUuid(id) ? await prisma.device.findFirst({ where: { id, institutionId } }) : null;
  if (!d) throw bad(404, 'DEVICE_NOT_FOUND', 'Device not found.');
  return d;
}

async function assertImeiFree(imei, exceptId) {
  const clash = await prisma.device.findUnique({ where: { imei } });
  if (clash && clash.id !== exceptId) throw bad(409, 'DUPLICATE_IMEI', 'A device with this IMEI is already registered.');
}

router.get('/devices', AUTH, wrap(async (req, res) => {
  const rows = await prisma.device.findMany({ where: { institutionId: req.user.institutionId }, include: deviceInclude, orderBy: { createdAt: 'desc' } });
  res.json({ success: true, data: rows.map(presentDevice) });
}));

router.post('/devices', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const { vehicleId, assetId, deviceType, imei, simIccid, firmwareVersion, status } = req.body;
  if (!deviceType || !imei) throw bad(422, 'MISSING_FIELDS', 'vehicleId, deviceType and imei are required.');
  if (status) assertEnum(status, DEVICE_STATUSES, 'status');
  // A device reports for one vehicle or one person/equipment, never both, and only the kind this institution tracks.
  if (vehicleId && assetId) throw bad(422, 'INVALID_TARGET', 'Choose a vehicle or a person, not both.');
  await assertTargetAllowed(institutionId, !!assetId);
  if (assetId) await ownAssetId(assetId, institutionId); else await ownVehicleId(vehicleId, institutionId);
  await assertImeiFree(String(imei));
  const type = await prisma.deviceType.findUnique({ where: { code: deviceType } });
  const interval = req.body.reportingIntervalS == null ? type?.defaultIntervalS : Number(req.body.reportingIntervalS);
  if (interval != null && !(Number.isInteger(interval) && interval >= 1 && interval <= 86400)) throw bad(422, 'INVALID_REPORTINGINTERVALS', 'reportingIntervalS must be a whole number of seconds, 1 to 86400.');
  const issued = type && ['json', 'osmand'].includes(type.adapter) ? newDeviceKey() : null;   // only these adapters authenticate with a key
  const d = await prisma.device.create({
    data: {
      institutionId, vehicleId: assetId ? null : vehicleId, assetId: assetId || null, deviceType, imei: String(imei), simIccid: simIccid || null, firmwareVersion: firmwareVersion || null,
      status: status || 'active', installedAt: new Date(), apiKeyHash: issued?.hash ?? null, reportingIntervalS: interval ?? null,
    },
    include: deviceInclude,
  });
  res.status(201).json({ success: true, data: { ...presentDevice(d), apiKey: issued?.key ?? null, setup: await setupGuide(req, d, issued?.key) } });
}));

// Setup text again for an existing device; the key itself is never recoverable, only rotated.
router.get('/devices/:id/setup', AUTH, wrap(async (req, res) => {
  const d = await ownDevice(req.params.id, req.user.institutionId);
  res.json({ success: true, data: { setup: await setupGuide(req, d, null), hasKey: !!d.apiKeyHash } });
}));

router.post('/devices/:id/rotate-key', AUTH, wrap(async (req, res) => {
  const d = await ownDevice(req.params.id, req.user.institutionId);
  const type = await prisma.deviceType.findUnique({ where: { code: d.deviceType } });
  if (!type || !['json', 'osmand'].includes(type.adapter)) throw bad(422, 'NO_DEVICE_KEY', 'This device type does not use a key.');
  const issued = newDeviceKey();
  const u = await prisma.device.update({ where: { id: d.id }, data: { apiKeyHash: issued.hash }, include: deviceInclude });
  res.json({ success: true, data: { ...presentDevice(u), apiKey: issued.key, setup: await setupGuide(req, u, issued.key) } });
}));

router.put('/devices/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  await ownDevice(req.params.id, institutionId);
  const b = req.body;
  const data = {};
  if (b.status !== undefined) { assertEnum(b.status, DEVICE_STATUSES, 'status'); data.status = b.status; }
  if (b.vehicleId && b.assetId) throw bad(422, 'INVALID_TARGET', 'Choose a vehicle or a person, not both.');
  if (b.assetId || b.vehicleId) await assertTargetAllowed(institutionId, !!b.assetId);
  if (b.assetId) { await ownAssetId(b.assetId, institutionId); data.assetId = b.assetId; data.vehicleId = null; }
  else if (b.vehicleId !== undefined) { await ownVehicleId(b.vehicleId, institutionId); data.vehicleId = b.vehicleId; data.assetId = null; }
  if (b.imei !== undefined) { await assertImeiFree(String(b.imei), req.params.id); data.imei = String(b.imei); }
  for (const f of ['deviceType', 'simIccid', 'firmwareVersion']) if (b[f] !== undefined) data[f] = b[f] || null;
  if (b.reportingIntervalS !== undefined) {
    const n = b.reportingIntervalS === null ? null : Number(b.reportingIntervalS);
    if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= 86400)) throw bad(422, 'INVALID_REPORTINGINTERVALS', 'reportingIntervalS must be a whole number of seconds, 1 to 86400.');
    data.reportingIntervalS = n;
  }
  if (data.deviceType === null) throw bad(422, 'MISSING_FIELDS', 'deviceType cannot be empty.');
  const d = await prisma.device.update({ where: { id: req.params.id }, data, include: deviceInclude });
  res.json({ success: true, data: presentDevice(d) });
}));

router.delete('/devices/:id', AUTH, wrap(async (req, res) => {
  await ownDevice(req.params.id, req.user.institutionId);
  await prisma.device.delete({ where: { id: req.params.id } });   // 409 via error handler when GPS history references it
  res.json({ success: true, data: { message: 'Device deleted.' } });
}));

// ── Live positions ───────────────────────────────────────────────────
router.get('/positions', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const rows = await prisma.$queryRaw`
    SELECT p.vehicle_id, v.vehicle_number, v.current_status,
           ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng,
           p.speed, p.heading, p.ignition_on, p.recorded_at, p.trip_id
    FROM vehicle_latest_position p
    JOIN vehicles v ON v.id = p.vehicle_id AND v.institution_id = p.institution_id
    WHERE p.institution_id = ${institutionId}::uuid
    ORDER BY v.vehicle_number`;
  res.json({
    success: true,
    data: rows.map((r) => ({
      vehicleId: r.vehicle_id, vehicleNumber: r.vehicle_number, status: r.current_status,
      lat: r.lat, lng: r.lng, speed: r.speed, heading: r.heading, ignitionOn: r.ignition_on,
      recordedAt: r.recorded_at, tripId: r.trip_id,
      isStale: Date.now() - new Date(r.recorded_at).getTime() > STALE_MS,
    })),
  });
}));

module.exports = router;
