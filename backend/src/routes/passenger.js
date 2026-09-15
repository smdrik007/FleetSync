'use strict';

/**
 * Passenger Routes (FR-PAS-01 → FR-PAS-05)
 * GET /api/v1/passenger/vehicles
 * GET /api/v1/passenger/vehicles/:vehicleId/status
 */

const router = require('express').Router();
const prisma = require('../db/client');
const { authenticate } = require('../middleware/auth');

const PASS = authenticate('PASSENGER');

const STALE_MS = parseInt(process.env.LOCATION_STALE_MS || '30000', 10);

// ── GET /passenger/vehicles ───────────────────────────────────────────
router.get('/vehicles', PASS, async (req, res, next) => {
  try {
    const { institutionId } = req.user;

    const vehicles = await prisma.vehicle.findMany({
      where: { institutionId },
      orderBy: { vehicleNumber: 'asc' },
      select: {
        id: true, vehicleNumber: true, plateNumber: true,
        currentStatus: true, assignedRoute: true,
        assignedDriver: { select: { id: true, name: true, phone: true } },
      },
    });

    const data = vehicles.map((v) => ({
      ...v,
      selectable: v.currentStatus !== 'MAINTENANCE' && v.currentStatus !== 'INACTIVE',
    }));

    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// ── GET /passenger/vehicles/:vehicleId/status ─────────────────────────
router.get('/vehicles/:vehicleId/status', PASS, async (req, res, next) => {
  try {
    const { institutionId } = req.user;

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: req.params.vehicleId, institutionId },
      select: {
        id: true, vehicleNumber: true, plateNumber: true,
        currentStatus: true, assignedRoute: true,
        assignedDriver: { select: { id: true, name: true, phone: true } },
        lastLatitude: true, lastLongitude: true, lastAccuracy: true, lastPositionAt: true,
      },
    });

    if (!vehicle) {
      return res.status(404).json({ success: false, error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found.' } });
    }

    // Find active trip
    const activeTrip = await prisma.trip.findFirst({
      where: { vehicleId: vehicle.id, status: 'IN_PROGRESS' },
      select: { id: true, startedAt: true, status: true },
    });

    // Build lastKnownPosition with isStale flag (FR-PAS-04)
    let lastKnownPosition = null;
    if (vehicle.lastLatitude !== null && vehicle.lastLongitude !== null) {
      const age = Date.now() - new Date(vehicle.lastPositionAt).getTime();
      lastKnownPosition = {
        latitude:  vehicle.lastLatitude,
        longitude: vehicle.lastLongitude,
        accuracy:  vehicle.lastAccuracy,
        updatedAt: vehicle.lastPositionAt,
        isStale:   age > STALE_MS,
      };
    }

    res.json({
      success: true,
      data: {
        id:             vehicle.id,
        vehicleNumber:  vehicle.vehicleNumber,
        plateNumber:    vehicle.plateNumber,
        currentStatus:  vehicle.currentStatus,
        assignedRoute:  vehicle.assignedRoute,
        assignedDriver: vehicle.assignedDriver,
        activeTrip,
        lastKnownPosition,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
