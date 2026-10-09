'use strict';

/**
 * Passenger Routes (FR-PAS-01 → FR-PAS-05)
 * GET /api/v1/passenger/vehicles
 * GET /api/v1/passenger/vehicles/:vehicleId/status
 */

const router = require('express').Router();
const prisma = require('../db/client');
const { Prisma } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { stopsByRoute } = require('../lib/routeStops');

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
        currentStatus: true, assignedRouteId: true, assignedRoute: { select: { name: true } },
        assignedDriver: { select: { id: true, name: true, phone: true } },
        latestPosition: { select: { speed: true, heading: true, recordedAt: true } },
      },
    });

    const vehicleIds = vehicles.map(v => v.id);
    // Prisma.join([]) renders `IN ()`, which Postgres rejects — an empty fleet has no positions.
    const locationsRaw = vehicleIds.length ? await prisma.$queryRaw`
      SELECT vehicle_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng 
      FROM vehicle_latest_position 
      WHERE institution_id = ${institutionId}::uuid AND vehicle_id::text IN (${Prisma.join(vehicleIds)})
    ` : [];
    const stops = await stopsByRoute(vehicles.map((v) => v.assignedRouteId));
    const locMap = locationsRaw.reduce((acc, loc) => {
      acc[loc.vehicle_id] = { lat: loc.lat, lng: loc.lng };
      return acc;
    }, {});

    const data = vehicles.map((v) => {
      const loc = locMap[v.id];
      return {
        ...v,
        assignedRoute: v.assignedRoute?.name || null,
        routeStops: stops.get(v.assignedRouteId) || [],
        selectable: v.currentStatus !== 'maintenance' && v.currentStatus !== 'offline' && v.currentStatus !== 'retired',
        lastKnownPosition: v.latestPosition ? {
          latitude: loc?.lat ?? null,
          longitude: loc?.lng ?? null,
          speed: v.latestPosition.speed,
          heading: v.latestPosition.heading,
          updatedAt: v.latestPosition.recordedAt,
          isStale: (Date.now() - new Date(v.latestPosition.recordedAt).getTime()) > (5 * 60 * 1000)
        } : null,
      };
    });

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
        currentStatus: true, assignedRouteId: true, assignedRoute: { select: { name: true } },
        assignedDriver: { select: { id: true, name: true, phone: true } },
        latestPosition: { select: { speed: true, heading: true, recordedAt: true } },
      },
    });

    if (!vehicle) {
      return res.status(404).json({ success: false, error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found.' } });
    }

    // Find active trip
    const activeTrip = await prisma.trip.findFirst({
      where: { vehicleId: vehicle.id, status: 'in_progress' },
      select: { id: true, startedAt: true, status: true },
    });

    // Build lastKnownPosition with isStale flag (FR-PAS-04)
    // Note: lat/lng are retrieved via PostGIS ST_X/ST_Y — using speed/heading from Prisma
    let lastKnownPosition = null;
    if (vehicle.latestPosition) {
      const locationsRaw = await prisma.$queryRaw`
        SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng 
        FROM vehicle_latest_position 
        WHERE vehicle_id = ${req.params.vehicleId}::uuid
      `;
      const loc = locationsRaw[0];

      const age = Date.now() - new Date(vehicle.latestPosition.recordedAt).getTime();
      lastKnownPosition = {
        latitude:  loc?.lat ?? null,
        longitude: loc?.lng ?? null,
        speed:    vehicle.latestPosition.speed,
        heading:  vehicle.latestPosition.heading,
        accuracy: null,
        updatedAt: vehicle.latestPosition.recordedAt,
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
        assignedRoute:  vehicle.assignedRoute?.name || null,
        routeStops:     (await stopsByRoute([vehicle.assignedRouteId])).get(vehicle.assignedRouteId) || [],
        assignedDriver: vehicle.assignedDriver,
        activeTrip,
        lastKnownPosition,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
