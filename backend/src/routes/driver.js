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
const { tripDistanceKm } = require('../lib/tripDistance');
const { recordPositions } = require('../lib/positions');

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
    const distanceKm = await tripDistanceKm(trip.id, institutionId); // the app uploads its queue before /end

    const [updatedTrip] = await prisma.$transaction([
      prisma.trip.update({
        where: { id: trip.id },
        data:  { status: 'completed', endedAt: now, distanceKm },
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
      data: { id: trip.id, tripId: trip.id, vehicleId: updatedTrip.vehicleId, startedAt: updatedTrip.startedAt, endedAt: updatedTrip.endedAt, status: updatedTrip.status, durationMinutes, distanceKm },
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

    // Start Trip guarantees a device (the phone's own, or an installed tracker); the vehicle's first one stores the point.
    const device = await prisma.device.findFirst({
      where: { vehicleId: trip.vehicleId, institutionId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, institutionId: true, vehicleId: true },
    });
    if (!device) return res.status(409).json({ success: false, error: { code: 'NO_DEVICE', message: 'This vehicle has no tracking device.' } });

    // Phone speed and heading are stored as the OS reports them. shortcut: phone speed is m/s while other devices store km/h, convert when the UIs are unified.
    await recordPositions(device, trip.id, [{
      ts: new Date(timestamp), lat: latitude, lng: longitude, speed: speed ?? null, heading: heading ?? null,
      accuracy: accuracy ?? null, ignition: true, battery: null, attrs: null,
    }]);

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
