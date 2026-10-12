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

const AUTH = authenticate('AUTHORITY');

const TRIP_STATUSES   = ['scheduled', 'in_progress', 'completed', 'cancelled'];
const DEVICE_STATUSES = ['active', 'inactive', 'faulty', 'retired'];
const STALE_MS  = 5 * 60 * 1000;
const MAX_POINTS = 2000;

const tripInclude = {
  vehicle: { select: { id: true, vehicleNumber: true } },
  driver:  { select: { id: true, name: true } },
  route:   { select: { id: true, name: true } },
};
const presentTrip = (t) => ({
  id: t.id, status: t.status, startedAt: t.startedAt, endedAt: t.endedAt,
  vehicle: t.vehicle, driver: t.driver, route: t.route || null,
});

async function ownTrip(id, institutionId) {
  const t = isUuid(id) ? await prisma.trip.findFirst({ where: { id, institutionId }, include: tripInclude }) : null;
  if (!t) throw bad(404, 'TRIP_NOT_FOUND', 'Trip not found.');
  return t;
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
  res.json({ success: true, data: rows.map(presentTrip) });
}));

router.get('/trips/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const t = await ownTrip(req.params.id, institutionId);
  const [{ n }] = await prisma.$queryRaw`SELECT count(*)::int AS n FROM gps_logs WHERE trip_id = ${t.id}::uuid AND institution_id = ${institutionId}::uuid`;
  const durationMinutes = t.endedAt ? Math.round((t.endedAt - t.startedAt) / 60000) : null;
  res.json({ success: true, data: { ...presentTrip(t), pointCount: n, durationMinutes } });
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
const presentDevice = (d) => ({
  id: d.id, vehicle: d.vehicle, deviceType: d.deviceType, imei: d.imei, simIccid: d.simIccid,
  firmwareVersion: d.firmwareVersion, status: d.status, installedAt: d.installedAt, lastSeenAt: d.lastSeenAt,
  isOnline: !!d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < STALE_MS,
});
const deviceInclude = { vehicle: { select: { id: true, vehicleNumber: true } } };

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
  const { vehicleId, deviceType, imei, simIccid, firmwareVersion, status } = req.body;
  if (!deviceType || !imei) throw bad(422, 'MISSING_FIELDS', 'vehicleId, deviceType and imei are required.');
  if (status) assertEnum(status, DEVICE_STATUSES, 'status');
  await ownVehicleId(vehicleId, institutionId);
  await assertImeiFree(String(imei));
  const d = await prisma.device.create({
    data: { institutionId, vehicleId, deviceType, imei: String(imei), simIccid: simIccid || null, firmwareVersion: firmwareVersion || null, status: status || 'active', installedAt: new Date() },
    include: deviceInclude,
  });
  res.status(201).json({ success: true, data: presentDevice(d) });
}));

router.put('/devices/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  await ownDevice(req.params.id, institutionId);
  const b = req.body;
  const data = {};
  if (b.status !== undefined) { assertEnum(b.status, DEVICE_STATUSES, 'status'); data.status = b.status; }
  if (b.vehicleId !== undefined) { await ownVehicleId(b.vehicleId, institutionId); data.vehicleId = b.vehicleId; }
  if (b.imei !== undefined) { await assertImeiFree(String(b.imei), req.params.id); data.imei = String(b.imei); }
  for (const f of ['deviceType', 'simIccid', 'firmwareVersion']) if (b[f] !== undefined) data[f] = b[f] || null;
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
