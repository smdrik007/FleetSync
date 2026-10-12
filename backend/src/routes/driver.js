'use strict';

/**
 * Driver Routes (FR-DRV-01 → FR-DRV-04)
 * GET  /api/v1/driver/me/assignment
 * POST /api/v1/driver/trips/start
 * POST /api/v1/driver/trips/:tripId/end
 * POST /api/v1/driver/trips/:tripId/location
 */

const router = require('express').Router();
const prisma = require('../db/client');
const { authenticate } = require('../middleware/auth');
const { emitVehicleEvent, emitLocationUpdate } = require('../ws/server');
const { stopsByRoute } = require('../lib/routeStops');

const DRV = authenticate('DRIVER');

async function resolveDriverId(userId, institutionId) {
  const driver = await prisma.driver.findFirst({
    where: { userId, institutionId },
    select: { id: true },
  });
  return driver ? driver.id : userId;
}

// ── GET /driver/me/assignment ─────────────────────────────────────────
router.get('/me/assignment', DRV, async (req, res, next) => {
  try {
    const driverId = await resolveDriverId(req.user.sub, req.user.institutionId);

    const vehicleRaw = await prisma.vehicle.findFirst({
      where: { assignedDriverId: driverId },
      select: {
        id: true, vehicleNumber: true, plateNumber: true,
        model: { select: { make: true, model: true, capacity: true } },
        currentStatus: true, assignedRouteId: true, assignedRoute: { select: { name: true } },
      },
    });
    const stops = vehicleRaw ? await stopsByRoute([vehicleRaw.assignedRouteId]) : new Map();

    const vehicle = vehicleRaw ? {
      ...vehicleRaw,
      model: vehicleRaw.model ? `${vehicleRaw.model.make || ''} ${vehicleRaw.model.model || ''}`.trim() : null,
      capacity: vehicleRaw.model?.capacity || null,
      assignedRoute: vehicleRaw.assignedRoute?.name || null,
      routeStops: stops.get(vehicleRaw.assignedRouteId) || [],
    } : null;

    let activeTrip = null;
    if (vehicle) {
      const trip = await prisma.trip.findFirst({
        where: { vehicleId: vehicle.id, driverId, status: 'in_progress' },
        select: { id: true, startedAt: true, status: true },
      });
      if (trip) {
        activeTrip = { id: trip.id, tripId: trip.id, startedAt: trip.startedAt, status: trip.status };
      }
    }

    res.json({
      success: true,
      data: { assigned: !!vehicle, driverId, vehicle: vehicle || null, activeTrip },
    });
  } catch (err) { next(err); }
});

// ── POST /driver/trips/start ──────────────────────────────────────────
router.post('/trips/start', DRV, async (req, res, next) => {
  try {
    const { institutionId } = req.user;
    const driverId = await resolveDriverId(req.user.sub, institutionId);

    const vehicle = await prisma.vehicle.findFirst({ where: { assignedDriverId: driverId } });
    if (!vehicle) {
      return res.status(409).json({ success: false, error: { code: 'NO_VEHICLE_ASSIGNED', message: 'No vehicle currently assigned to you.' } });
    }

    const existing = await prisma.trip.findFirst({ where: { vehicleId: vehicle.id, status: 'in_progress' } });
    if (existing) {
      return res.status(409).json({ success: false, error: { code: 'TRIP_ALREADY_ACTIVE', message: 'A trip is already in progress for this vehicle.' } });
    }

    // The location insert reads device_id from devices, so a vehicle with no tracker would silently store nothing.
    // The driver's phone becomes its tracker. shortcut: phone pseudo-IMEI, replace when real trackers are registered
    const hasDevice = await prisma.device.findFirst({ where: { vehicleId: vehicle.id }, select: { id: true } });
    const phoneImei = `phone-${vehicle.id}`;

    // Create trip + set vehicle to ON_TRIP in a transaction
    const [trip] = await prisma.$transaction([
      prisma.trip.create({
        data: { institutionId, vehicleId: vehicle.id, driverId, routeId: vehicle.assignedRouteId || null, status: 'in_progress', startedAt: new Date() },
        select: { id: true, vehicleId: true, startedAt: true, status: true },
      }),
      prisma.vehicle.update({
        where: { id: vehicle.id },
        data:  { currentStatus: 'on_trip' },
      }),
      ...(hasDevice ? [] : [prisma.device.upsert({
        where:  { imei: phoneImei },
        update: {},
        create: { institutionId, vehicleId: vehicle.id, deviceType: 'phone', imei: phoneImei, installedAt: new Date() },
      })]),
    ]);

    // Broadcast status change (FR-POOL-05)
    emitVehicleEvent({
      event: 'vehicle.status_changed',
      data:  { vehicleId: vehicle.id, vehicleNumber: vehicle.vehicleNumber, previousStatus: vehicle.currentStatus, currentStatus: 'on_trip', changedAt: new Date().toISOString(), institutionId },
      vehicleId: vehicle.id, driverId, institutionId,
    });

    emitVehicleEvent({
      event: 'trip.started',
      data:  { tripId: trip.id, vehicleId: vehicle.id, vehicleNumber: vehicle.vehicleNumber, startedAt: trip.startedAt, institutionId },
      vehicleId: vehicle.id, driverId, institutionId,
    });

    res.status(201).json({
      success: true,
      data: { id: trip.id, tripId: trip.id, vehicleId: vehicle.id, vehicleNumber: vehicle.vehicleNumber, startedAt: trip.startedAt, status: trip.status },
    });
  } catch (err) { next(err); }
});

// ── POST /driver/trips/:tripId/end ────────────────────────────────────
router.post('/trips/:tripId/end', DRV, async (req, res, next) => {
  try {
    const { institutionId } = req.user;
    const driverId = await resolveDriverId(req.user.sub, institutionId);
    const { tripId }    = req.params;

    const whereClause = (tripId && tripId !== 'current' && tripId !== 'active' && tripId !== 'undefined')
      ? { id: tripId, driverId }
      : { driverId, status: 'in_progress' };

    const trip = await prisma.trip.findFirst({
      where: whereClause,
      include: { vehicle: { select: { id: true, vehicleNumber: true } } },
    });

    if (!trip) return res.status(404).json({ success: false, error: { code: 'TRIP_NOT_FOUND', message: 'No active trip found for this driver.' } });
    if (trip.status === 'completed') return res.status(409).json({ success: false, error: { code: 'TRIP_ALREADY_ENDED', message: 'This trip has already ended.' } });

    const now = new Date();
    const durationMinutes = Math.round((now - trip.startedAt) / 60000);

    const [updatedTrip] = await prisma.$transaction([
      prisma.trip.update({
        where: { id: trip.id },
        data:  { status: 'completed', endedAt: now },
        select: { id: true, vehicleId: true, startedAt: true, endedAt: true, status: true },
      }),
      prisma.vehicle.update({
        where: { id: trip.vehicleId },
        data:  { currentStatus: 'idle' },
      }),
    ]);
    
    // Clear last position
    await prisma.vehicleLatestPosition.deleteMany({ where: { vehicleId: trip.vehicleId } });

    // Broadcast (FR-POOL-05)
    emitVehicleEvent({
      event: 'vehicle.status_changed',
      data:  { vehicleId: trip.vehicleId, vehicleNumber: trip.vehicle.vehicleNumber, previousStatus: 'on_trip', currentStatus: 'idle', changedAt: now.toISOString(), institutionId },
      vehicleId: trip.vehicleId, driverId, institutionId,
    });

    emitVehicleEvent({
      event: 'trip.ended',
      data:  { tripId: trip.id, vehicleId: trip.vehicleId, vehicleNumber: trip.vehicle.vehicleNumber, endedAt: now.toISOString(), institutionId },
      vehicleId: trip.vehicleId, driverId, institutionId,
    });

    res.json({
      success: true,
      data: { id: trip.id, tripId: trip.id, vehicleId: updatedTrip.vehicleId, startedAt: updatedTrip.startedAt, endedAt: updatedTrip.endedAt, status: updatedTrip.status, durationMinutes },
    });
  } catch (err) { next(err); }
});

// ── POST /driver/trips/:tripId/location ───────────────────────────────
router.post('/trips/:tripId/location', DRV, async (req, res, next) => {
  try {
    const { institutionId } = req.user;
    const driverId = await resolveDriverId(req.user.sub, institutionId);
    const { tripId }    = req.params;
    const { latitude, longitude, accuracy, heading, speed, timestamp } = req.body;

    if (latitude === undefined || longitude === undefined || !timestamp) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'latitude, longitude, and timestamp are required.' } });
    }

    // Validate coordinate ranges
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_COORDINATES', message: 'Coordinates out of valid range.' } });
    }

    // Verify trip is active and belongs to this driver (FR-DRV-03 — blocks off-duty tracking)
    const locWhereClause = (tripId && tripId !== 'current' && tripId !== 'active' && tripId !== 'undefined')
      ? { id: tripId, driverId }
      : { driverId, status: 'in_progress' };

    const trip = await prisma.trip.findFirst({
      where: locWhereClause,
      include: { vehicle: { select: { id: true, vehicleNumber: true } } },
    });

    if (!trip) return res.status(404).json({ success: false, error: { code: 'TRIP_NOT_FOUND', message: 'Trip not found.' } });
    if (trip.status !== 'in_progress') {
      return res.status(403).json({ success: false, error: { code: 'TRIP_NOT_ACTIVE', message: 'GPS tracking is only active during an in-progress trip.' } });
    }

    // Persist last known position (PostGIS geography — stored via raw SQL)
    // We store the position using ST_MakePoint and upsert via $executeRaw
    const pgTimestamp = new Date(timestamp).toISOString();
    await prisma.$transaction(async (tx) => {
      // Upsert vehicle_latest_position with PostGIS geography
      await tx.$executeRaw`
        INSERT INTO vehicle_latest_position
          (vehicle_id, institution_id, device_id, trip_id, location, speed, heading, recorded_at, updated_at)
        SELECT
          ${trip.vehicleId}::uuid,
          ${institutionId}::uuid,
          d.id,
          ${trip.id}::uuid,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326),
          ${speed ?? null},
          ${heading ?? null},
          ${pgTimestamp}::timestamptz,
          now()
        FROM devices d
        WHERE d.vehicle_id = ${trip.vehicleId}::uuid
        LIMIT 1
        ON CONFLICT (vehicle_id) DO UPDATE SET
          location    = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326),
          speed       = ${speed ?? null},
          heading     = ${heading ?? null},
          trip_id     = ${trip.id}::uuid,
          recorded_at = ${pgTimestamp}::timestamptz,
          updated_at  = now()
        WHERE vehicle_latest_position.recorded_at < ${pgTimestamp}::timestamptz
      `;
      // Insert GPS log with PostGIS geography
      await tx.$executeRaw`
        INSERT INTO gps_logs
          (recorded_at, institution_id, vehicle_id, device_id, trip_id, location, accuracy, speed, heading, ignition_on, received_at)
        SELECT
          ${pgTimestamp}::timestamptz,
          ${institutionId}::uuid,
          ${trip.vehicleId}::uuid,
          d.id,
          ${trip.id}::uuid,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326),
          ${accuracy ?? null},
          ${speed ?? null},
          ${heading ?? null},
          true,
          now()
        FROM devices d
        WHERE d.vehicle_id = ${trip.vehicleId}::uuid
        LIMIT 1
      `;
      // The tracker just reported in: this is what the dashboard's "devices online" and each device's "last seen" read.
      await tx.$executeRaw`UPDATE devices SET last_seen_at = now() WHERE vehicle_id = ${trip.vehicleId}::uuid AND institution_id = ${institutionId}::uuid`;
    });

    // Broadcast to vehicle room and institution (FR-PAS-02)
    emitLocationUpdate({
      data: { vehicleId: trip.vehicleId, vehicleNumber: trip.vehicle.vehicleNumber, tripId, latitude, longitude, accuracy: accuracy ?? null, heading: heading ?? null, speed: speed ?? null, timestamp, institutionId },
      vehicleId: trip.vehicleId,
      institutionId,
    });

    res.json({ success: true, data: { received: true } });
  } catch (err) { next(err); }
});

module.exports = router;
