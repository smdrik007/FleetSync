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

const DRV = authenticate('DRIVER');

// ── GET /driver/me/assignment ─────────────────────────────────────────
router.get('/me/assignment', DRV, async (req, res, next) => {
  try {
    const driverId = req.user.sub;

    const vehicle = await prisma.vehicle.findFirst({
      where: { assignedDriverId: driverId },
      select: {
        id: true, vehicleNumber: true, plateNumber: true,
        model: true, capacity: true, currentStatus: true, assignedRoute: true,
      },
    });

    let activeTrip = null;
    if (vehicle) {
      const trip = await prisma.trip.findFirst({
        where: { vehicleId: vehicle.id, driverId, status: 'IN_PROGRESS' },
        select: { id: true, startedAt: true, status: true },
      });
      if (trip) {
        activeTrip = { id: trip.id, tripId: trip.id, startedAt: trip.startedAt, status: trip.status };
      }
    }

    res.json({
      success: true,
      data: { assigned: !!vehicle, vehicle: vehicle || null, activeTrip },
    });
  } catch (err) { next(err); }
});

// ── POST /driver/trips/start ──────────────────────────────────────────
router.post('/trips/start', DRV, async (req, res, next) => {
  try {
    const driverId      = req.user.sub;
    const { institutionId } = req.user;

    const vehicle = await prisma.vehicle.findFirst({ where: { assignedDriverId: driverId } });
    if (!vehicle) {
      return res.status(409).json({ success: false, error: { code: 'NO_VEHICLE_ASSIGNED', message: 'No vehicle currently assigned to you.' } });
    }

    const existing = await prisma.trip.findFirst({ where: { vehicleId: vehicle.id, status: 'IN_PROGRESS' } });
    if (existing) {
      return res.status(409).json({ success: false, error: { code: 'TRIP_ALREADY_ACTIVE', message: 'A trip is already in progress for this vehicle.' } });
    }

    // Create trip + set vehicle to ON_TRIP in a transaction
    const [trip] = await prisma.$transaction([
      prisma.trip.create({
        data: { vehicleId: vehicle.id, driverId, status: 'IN_PROGRESS' },
        select: { id: true, vehicleId: true, startedAt: true, status: true },
      }),
      prisma.vehicle.update({
        where: { id: vehicle.id },
        data:  { currentStatus: 'ON_TRIP' },
      }),
    ]);

    // Broadcast status change (FR-POOL-05)
    emitVehicleEvent({
      event: 'vehicle.status_changed',
      data:  { vehicleId: vehicle.id, vehicleNumber: vehicle.vehicleNumber, previousStatus: vehicle.currentStatus, currentStatus: 'ON_TRIP', changedAt: new Date().toISOString(), institutionId },
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
    const driverId      = req.user.sub;
    const { institutionId } = req.user;
    const { tripId }    = req.params;

    const whereClause = (tripId && tripId !== 'current' && tripId !== 'active' && tripId !== 'undefined')
      ? { id: tripId, driverId }
      : { driverId, status: 'IN_PROGRESS' };

    const trip = await prisma.trip.findFirst({
      where: whereClause,
      include: { vehicle: { select: { id: true, vehicleNumber: true } } },
    });

    if (!trip) return res.status(404).json({ success: false, error: { code: 'TRIP_NOT_FOUND', message: 'No active trip found for this driver.' } });
    if (trip.status === 'COMPLETED') return res.status(409).json({ success: false, error: { code: 'TRIP_ALREADY_ENDED', message: 'This trip has already ended.' } });

    const now = new Date();
    const durationMinutes = Math.round((now - trip.startedAt) / 60000);

    const [updatedTrip] = await prisma.$transaction([
      prisma.trip.update({
        where: { id: trip.id },
        data:  { status: 'COMPLETED', endedAt: now },
        select: { id: true, vehicleId: true, startedAt: true, endedAt: true, status: true },
      }),
      prisma.vehicle.update({
        where: { id: trip.vehicleId },
        data:  { currentStatus: 'ACTIVE', lastLatitude: null, lastLongitude: null, lastPositionAt: null },
      }),
    ]);

    // Broadcast (FR-POOL-05)
    emitVehicleEvent({
      event: 'vehicle.status_changed',
      data:  { vehicleId: trip.vehicleId, vehicleNumber: trip.vehicle.vehicleNumber, previousStatus: 'ON_TRIP', currentStatus: 'ACTIVE', changedAt: now.toISOString(), institutionId },
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
    const driverId      = req.user.sub;
    const { institutionId } = req.user;
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
      : { driverId, status: 'IN_PROGRESS' };

    const trip = await prisma.trip.findFirst({
      where: locWhereClause,
      include: { vehicle: { select: { id: true, vehicleNumber: true } } },
    });

    if (!trip) return res.status(404).json({ success: false, error: { code: 'TRIP_NOT_FOUND', message: 'Trip not found.' } });
    if (trip.status !== 'IN_PROGRESS') {
      return res.status(403).json({ success: false, error: { code: 'TRIP_NOT_ACTIVE', message: 'GPS tracking is only active during an in-progress trip.' } });
    }

    // Persist last known position on vehicle
    await prisma.vehicle.update({
      where: { id: trip.vehicleId },
      data:  { lastLatitude: latitude, lastLongitude: longitude, lastAccuracy: accuracy ?? null, lastPositionAt: new Date(timestamp) },
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
