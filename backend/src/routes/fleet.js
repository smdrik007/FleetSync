'use strict';

/**
 * Fleet Routes — Authority only (FR-POOL-01 → FR-POOL-05)
 * GET    /api/v1/fleet/vehicles
 * POST   /api/v1/fleet/vehicles
 * GET    /api/v1/fleet/vehicles/:vehicleId
 * PUT    /api/v1/fleet/vehicles/:vehicleId
 * DELETE /api/v1/fleet/vehicles/:vehicleId
 * GET    /api/v1/fleet/drivers
 */

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const prisma = require('../db/client');
const { Prisma } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { emitVehicleEvent } = require('../ws/server');
const { bad } = require('../lib/http');

const AUTH = authenticate('AUTHORITY');

// ─── Helper: select fields returned to Authority ──────────────────────
// Note: latestPosition.location is PostGIS geography — query with raw SQL for lat/lng.
// We select recordedAt and use a separate raw query if coordinates are needed.
const vehicleSelect = {
  id: true, institutionId: true, modelId: true, assignedRouteId: true,
  vehicleNumber: true, plateNumber: true, fuelEfficiencyKmpl: true,
  model: { select: { make: true, model: true, capacity: true } },
  currentStatus: true, 
  assignedRoute: { select: { name: true } },
  assignedDriver: { select: { id: true, name: true, phone: true } },
  latestPosition: { select: { recordedAt: true, speed: true, heading: true } },
  createdAt: true, updatedAt: true,
};

// Prisma returns Decimal as a string in JSON; the console wants a number.
const toNum = (d) => (d === null || d === undefined ? null : Number(d));

/** undefined = field not sent (leave as is); '' / null clears it; otherwise a km/L between 0 and 100. */
function parseKmpl(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 100) throw bad(422, 'INVALID_EFFICIENCY', 'fuelEfficiencyKmpl must be a number between 0 and 100.');
  return n;
}

// Valid vehicle statuses per SQL schema CHECK constraint
const VEHICLE_STATUSES = ['idle', 'on_trip', 'maintenance', 'offline', 'retired'];

// ── GET /fleet/vehicles ───────────────────────────────────────────────
router.get('/vehicles', AUTH, async (req, res, next) => {
  try {
    const { institutionId } = req.user;
    const { status } = req.query;

    const vehiclesRaw = await prisma.vehicle.findMany({
      where: {
        institutionId,
        ...(status ? { currentStatus: status } : {}),
      },
      select: vehicleSelect,
      orderBy: { vehicleNumber: 'asc' },
    });

    const vehicleIds = vehiclesRaw.map(v => v.id);
    // Prisma.join([]) renders `IN ()`, which Postgres rejects — an empty fleet has no positions.
    const locationsRaw = vehicleIds.length ? await prisma.$queryRaw`
      SELECT vehicle_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng 
      FROM vehicle_latest_position 
      WHERE institution_id = ${institutionId}::uuid AND vehicle_id::text IN (${Prisma.join(vehicleIds)})
    ` : [];
    const locMap = locationsRaw.reduce((acc, loc) => {
      acc[loc.vehicle_id] = { lat: loc.lat, lng: loc.lng };
      return acc;
    }, {});

    const vehicles = vehiclesRaw.map(v => {
      const loc = locMap[v.id];
      return {
        ...v,
        fuelEfficiencyKmpl: toNum(v.fuelEfficiencyKmpl),
        model: v.model ? `${v.model.make || ''} ${v.model.model || ''}`.trim() : null,
        capacity: v.model?.capacity || null,
        assignedRoute: v.assignedRoute?.name || null,
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

    res.json({ success: true, data: vehicles });
  } catch (err) { next(err); }
});

/** Validate optional modelId / assignedRouteId against the caller's tenant (models may be global). */
async function checkRefs(institutionId, { modelId, assignedRouteId }) {
  if (modelId) {
    const m = await prisma.vehicleModel.findFirst({ where: { id: modelId, OR: [{ institutionId }, { institutionId: null }] } });
    if (!m) throw bad(422, 'INVALID_MODEL', 'Vehicle model not found.');
  }
  if (assignedRouteId) {
    const r = await prisma.route.findFirst({ where: { id: assignedRouteId, institutionId } });
    if (!r) throw bad(422, 'INVALID_ROUTE', 'Route not found in your institution.');
  }
}

// ── POST /fleet/vehicles ──────────────────────────────────────────────
router.post('/vehicles', AUTH, async (req, res, next) => {
  try {
    const { institutionId } = req.user;
    const { vehicleNumber, plateNumber, model, capacity, currentStatus, assignedRoute, assignedDriverId, modelId, assignedRouteId } = req.body;

    if (!vehicleNumber || !plateNumber) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'vehicleNumber and plateNumber are required.' },
      });
    }

    // Validate driver belongs to same institution
    if (assignedDriverId) {
      const driver = await prisma.driver.findFirst({ where: { id: assignedDriverId, institutionId } });
      if (!driver) return res.status(404).json({ success: false, error: { code: 'DRIVER_NOT_FOUND', message: 'Driver not found in your institution.' } });
    }

    await checkRefs(institutionId, { modelId, assignedRouteId });
    if (!modelId && !model) throw bad(422, 'MISSING_MODEL', 'modelId (or a model name) is required.');

    let resolvedModelId = modelId || null;
    if (!modelId && model) {
      const m = await prisma.vehicleModel.findFirst({ where: { model, OR: [{ institutionId }, { institutionId: null }] } });
      if (m) resolvedModelId = m.id;
      else {
        const newM = await prisma.vehicleModel.create({ data: { institutionId, make: 'Unknown', model, capacity: capacity || 10 } });
        resolvedModelId = newM.id;
      }
    }

    let resolvedRouteId = assignedRouteId || null;
    if (!assignedRouteId && assignedRoute) {
      const r = await prisma.route.findFirst({ where: { institutionId, name: assignedRoute } });
      if (r) resolvedRouteId = r.id;
      else {
        const newR = await prisma.route.create({ data: { institutionId, name: assignedRoute } });
        resolvedRouteId = newR.id;
      }
    }

    const fuelEfficiencyKmpl = parseKmpl(req.body.fuelEfficiencyKmpl) ?? null;
    const vehicleRaw = await prisma.vehicle.create({
      data: { institutionId, vehicleNumber, plateNumber, fuelEfficiencyKmpl, modelId: resolvedModelId, currentStatus: currentStatus || 'idle', assignedRouteId: resolvedRouteId, assignedDriverId: assignedDriverId || null },
      select: vehicleSelect,
    });

    // A driver drives one vehicle: moving them here frees their previous vehicle (same rule as PUT).
    if (assignedDriverId) {
      await prisma.vehicle.updateMany({ where: { institutionId, assignedDriverId, id: { not: vehicleRaw.id } }, data: { assignedDriverId: null } });
    }

    const vehicle = {
      ...vehicleRaw,
      fuelEfficiencyKmpl: toNum(vehicleRaw.fuelEfficiencyKmpl),
      model: vehicleRaw.model ? `${vehicleRaw.model.make || ''} ${vehicleRaw.model.model || ''}`.trim() : null,
      capacity: vehicleRaw.model?.capacity || null,
      assignedRoute: vehicleRaw.assignedRoute?.name || null,
    };

    res.status(201).json({ success: true, data: vehicle });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, error: { code: 'PLATE_DUPLICATE', message: 'Plate number or vehicle number already exists.' } });
    }
    next(err);
  }
});

// ── GET /fleet/vehicles/:vehicleId ────────────────────────────────────
router.get('/vehicles/:vehicleId', AUTH, async (req, res, next) => {
  try {
    const { institutionId } = req.user;
    const vehicleRaw = await prisma.vehicle.findFirst({
      where: { id: req.params.vehicleId, institutionId },
      select: vehicleSelect,
    });

    if (!vehicleRaw) return res.status(404).json({ success: false, error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found.' } });

    const locationsRaw = await prisma.$queryRaw`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng 
      FROM vehicle_latest_position 
      WHERE vehicle_id = ${req.params.vehicleId}::uuid
    `;
    const loc = locationsRaw[0];

    const vehicle = {
      ...vehicleRaw,
      fuelEfficiencyKmpl: toNum(vehicleRaw.fuelEfficiencyKmpl),
      model: vehicleRaw.model ? `${vehicleRaw.model.make || ''} ${vehicleRaw.model.model || ''}`.trim() : null,
      capacity: vehicleRaw.model?.capacity || null,
      assignedRoute: vehicleRaw.assignedRoute?.name || null,
      lastKnownPosition: vehicleRaw.latestPosition ? {
        latitude: loc?.lat ?? null,
        longitude: loc?.lng ?? null,
        speed: vehicleRaw.latestPosition.speed,
        heading: vehicleRaw.latestPosition.heading,
        updatedAt: vehicleRaw.latestPosition.recordedAt,
        isStale: (Date.now() - new Date(vehicleRaw.latestPosition.recordedAt).getTime()) > (5 * 60 * 1000)
      } : null,
    };

    res.json({ success: true, data: vehicle });
  } catch (err) { next(err); }
});

// ── PUT /fleet/vehicles/:vehicleId ────────────────────────────────────
router.put('/vehicles/:vehicleId', AUTH, async (req, res, next) => {
  try {
    const { institutionId } = req.user;
    const vehicleId = req.params.vehicleId;

    // Verify vehicle belongs to this institution
    const existing = await prisma.vehicle.findFirst({ where: { id: vehicleId, institutionId } });
    if (!existing) return res.status(404).json({ success: false, error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found.' } });

    const { vehicleNumber, plateNumber, model, capacity, currentStatus, assignedRoute, assignedDriverId, modelId, assignedRouteId } = req.body;
    const kmpl = parseKmpl(req.body.fuelEfficiencyKmpl);
    await checkRefs(institutionId, { modelId, assignedRouteId });

    // Validate status enum
    if (currentStatus && !VEHICLE_STATUSES.includes(currentStatus)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: `Status must be one of: ${VEHICLE_STATUSES.join(', ')}.` } });
    }

    // Validate driver and handle conflict-prevention (FR-POOL-03)
    const newDriverId = Object.prototype.hasOwnProperty.call(req.body, 'assignedDriverId')
      ? (assignedDriverId || null)
      : undefined; // undefined means "don't change"

    if (newDriverId !== undefined && newDriverId !== null) {
      const driver = await prisma.driver.findFirst({ where: { id: newDriverId, institutionId } });
      if (!driver) return res.status(404).json({ success: false, error: { code: 'DRIVER_NOT_FOUND', message: 'Driver not found in your institution.' } });

      // Conflict prevention — unbind driver from their previous vehicle
      await prisma.vehicle.updateMany({
        where: { institutionId, assignedDriverId: newDriverId, id: { not: vehicleId } },
        data:  { assignedDriverId: null },
      });
    }

    // Build update payload (only include defined fields)
    const updateData = {};
    if (vehicleNumber  !== undefined) updateData.vehicleNumber  = vehicleNumber;
    if (plateNumber    !== undefined) updateData.plateNumber    = plateNumber;
    if (currentStatus  !== undefined) updateData.currentStatus  = currentStatus;
    if (newDriverId    !== undefined) updateData.assignedDriverId = newDriverId;
    if (kmpl !== undefined) updateData.fuelEfficiencyKmpl = kmpl;

    if (modelId) updateData.modelId = modelId;
    const hasRouteId = Object.prototype.hasOwnProperty.call(req.body, 'assignedRouteId');
    if (hasRouteId) updateData.assignedRouteId = assignedRouteId || null;

    if (!modelId && model !== undefined) {
      const m = await prisma.vehicleModel.findFirst({ where: { model, OR: [{ institutionId }, { institutionId: null }] } });
      if (m) updateData.modelId = m.id;
      else {
        const newM = await prisma.vehicleModel.create({ data: { institutionId, make: 'Unknown', model, capacity: capacity || 10 } });
        updateData.modelId = newM.id;
      }
    }

    if (!hasRouteId && assignedRoute !== undefined) {
      const r = await prisma.route.findFirst({ where: { institutionId, name: assignedRoute } });
      if (r) updateData.assignedRouteId = r.id;
      else {
        const newR = await prisma.route.create({ data: { institutionId, name: assignedRoute } });
        updateData.assignedRouteId = newR.id;
      }
    }

    const updatedRaw = await prisma.vehicle.update({
      where:  { id: vehicleId },
      data:   updateData,
      select: vehicleSelect,
    });

    const updated = {
      ...updatedRaw,
      fuelEfficiencyKmpl: toNum(updatedRaw.fuelEfficiencyKmpl),
      model: updatedRaw.model ? `${updatedRaw.model.make || ''} ${updatedRaw.model.model || ''}`.trim() : null,
      capacity: updatedRaw.model?.capacity || null,
      assignedRoute: updatedRaw.assignedRoute?.name || null,
    };

    // ── Real-time broadcasts (FR-POOL-05) ─────────────────────────────
    const driverId = updatedRaw.assignedDriver?.id || null;

    // The console sends assignedRouteId; older callers send the route name — either changes what drivers/passengers see.
    if (assignedRoute !== undefined || hasRouteId) {
      emitVehicleEvent({
        event: 'vehicle.route_updated',
        data:  { vehicleId, vehicleNumber: updated.vehicleNumber, assignedRoute: updated.assignedRoute, updatedAt: updated.updatedAt, institutionId },
        vehicleId, driverId, institutionId,
      });
    }

    if (newDriverId !== undefined) {
      emitVehicleEvent({
        event: 'vehicle.driver_assigned',
        data:  { vehicleId, vehicleNumber: updated.vehicleNumber, previousDriverId: existing.assignedDriverId, newDriver: updated.assignedDriver, updatedAt: updated.updatedAt, institutionId },
        vehicleId, driverId, institutionId,
      });
      // Also notify previously assigned driver
      if (existing.assignedDriverId && existing.assignedDriverId !== newDriverId) {
        const { broadcast, getRoomKey } = require('../ws/server');
        broadcast(getRoomKey('driver', existing.assignedDriverId), {
          event: 'vehicle.driver_assigned',
          data:  { vehicleId, vehicleNumber: updated.vehicleNumber, previousDriverId: existing.assignedDriverId, newDriver: null, updatedAt: updated.updatedAt, institutionId },
        });
      }
    }

    if (currentStatus !== undefined && currentStatus !== existing.currentStatus) {
      emitVehicleEvent({
        event: 'vehicle.status_changed',
        data:  { vehicleId, vehicleNumber: updated.vehicleNumber, previousStatus: existing.currentStatus, currentStatus: updated.currentStatus, changedAt: updated.updatedAt, institutionId },
        vehicleId, driverId, institutionId,
      });
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, error: { code: 'PLATE_DUPLICATE', message: 'Plate number or vehicle number already in use.' } });
    }
    next(err);
  }
});

// ── DELETE /fleet/vehicles/:vehicleId ─────────────────────────────────
router.delete('/vehicles/:vehicleId', AUTH, async (req, res, next) => {
  try {
    const { institutionId } = req.user;
    const vehicle = await prisma.vehicle.findFirst({ where: { id: req.params.vehicleId, institutionId } });

    if (!vehicle) return res.status(404).json({ success: false, error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found.' } });
    if (vehicle.currentStatus === 'on_trip') {
      return res.status(409).json({ success: false, error: { code: 'VEHICLE_ON_TRIP', message: 'Cannot decommission a vehicle that is currently on a trip.' } });
    }

    // Soft delete via status change (or hard delete — using hard delete for simplicity)
    await prisma.vehicle.delete({ where: { id: vehicle.id } });
    res.json({ success: true, data: { message: 'Vehicle decommissioned.' } });
  } catch (err) { next(err); }
});

// Driver list/create/update/delete: see routes/admin.js

module.exports = router;
