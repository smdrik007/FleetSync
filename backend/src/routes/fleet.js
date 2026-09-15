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
const prisma = require('../db/client');
const { authenticate } = require('../middleware/auth');
const { emitVehicleEvent } = require('../ws/server');

const AUTH = authenticate('AUTHORITY');

// ─── Helper: select fields returned to Authority ──────────────────────
const vehicleSelect = {
  id: true, institutionId: true,
  vehicleNumber: true, plateNumber: true, model: true, capacity: true,
  currentStatus: true, assignedRoute: true,
  assignedDriver: { select: { id: true, name: true, phone: true, email: true } },
  createdAt: true, updatedAt: true,
};

// ── GET /fleet/vehicles ───────────────────────────────────────────────
router.get('/vehicles', AUTH, async (req, res, next) => {
  try {
    const { institutionId } = req.user;
    const { status } = req.query;

    const vehicles = await prisma.vehicle.findMany({
      where: {
        institutionId,
        ...(status ? { currentStatus: status } : {}),
      },
      select: vehicleSelect,
      orderBy: { vehicleNumber: 'asc' },
    });

    res.json({ success: true, data: vehicles });
  } catch (err) { next(err); }
});

// ── POST /fleet/vehicles ──────────────────────────────────────────────
router.post('/vehicles', AUTH, async (req, res, next) => {
  try {
    const { institutionId } = req.user;
    const { vehicleNumber, plateNumber, model, capacity, currentStatus, assignedRoute, assignedDriverId } = req.body;

    if (!vehicleNumber || !plateNumber) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'vehicleNumber and plateNumber are required.' },
      });
    }

    // Validate driver belongs to same institution
    if (assignedDriverId) {
      const driver = await prisma.user.findFirst({ where: { id: assignedDriverId, institutionId, role: 'DRIVER' } });
      if (!driver) return res.status(404).json({ success: false, error: { code: 'DRIVER_NOT_FOUND', message: 'Driver not found in your institution.' } });
    }

    const vehicle = await prisma.vehicle.create({
      data: { institutionId, vehicleNumber, plateNumber, model, capacity, currentStatus: currentStatus || 'INACTIVE', assignedRoute: assignedRoute || '', assignedDriverId: assignedDriverId || null },
      select: vehicleSelect,
    });

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
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: req.params.vehicleId, institutionId },
      select: vehicleSelect,
    });

    if (!vehicle) return res.status(404).json({ success: false, error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found.' } });
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

    const { vehicleNumber, plateNumber, model, capacity, currentStatus, assignedRoute, assignedDriverId } = req.body;

    // Validate status enum
    const validStatuses = ['ACTIVE', 'ON_TRIP', 'MAINTENANCE', 'INACTIVE'];
    if (currentStatus && !validStatuses.includes(currentStatus)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: `Status must be one of: ${validStatuses.join(', ')}.` } });
    }

    // Validate driver and handle conflict-prevention (FR-POOL-03)
    const newDriverId = Object.prototype.hasOwnProperty.call(req.body, 'assignedDriverId')
      ? (assignedDriverId || null)
      : undefined; // undefined means "don't change"

    if (newDriverId !== undefined && newDriverId !== null) {
      const driver = await prisma.user.findFirst({ where: { id: newDriverId, institutionId, role: 'DRIVER' } });
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
    if (model          !== undefined) updateData.model          = model;
    if (capacity       !== undefined) updateData.capacity       = capacity;
    if (currentStatus  !== undefined) updateData.currentStatus  = currentStatus;
    if (assignedRoute  !== undefined) updateData.assignedRoute  = assignedRoute;
    if (newDriverId    !== undefined) updateData.assignedDriverId = newDriverId;

    const updated = await prisma.vehicle.update({
      where:  { id: vehicleId },
      data:   updateData,
      select: vehicleSelect,
    });

    // ── Real-time broadcasts (FR-POOL-05) ─────────────────────────────
    const driverId = updated.assignedDriver?.id || null;

    if (assignedRoute !== undefined) {
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
    if (vehicle.currentStatus === 'ON_TRIP') {
      return res.status(409).json({ success: false, error: { code: 'VEHICLE_ON_TRIP', message: 'Cannot decommission a vehicle that is currently on a trip.' } });
    }

    // Soft delete via status change (or hard delete — using hard delete for simplicity)
    await prisma.vehicle.delete({ where: { id: vehicle.id } });
    res.json({ success: true, data: { message: 'Vehicle decommissioned.' } });
  } catch (err) { next(err); }
});

// ── GET /fleet/drivers ────────────────────────────────────────────────
router.get('/drivers', AUTH, async (req, res, next) => {
  try {
    const { institutionId } = req.user;

    const drivers = await prisma.user.findMany({
      where: { institutionId, role: 'DRIVER' },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, phone: true, email: true,
        assignedVehicle: { select: { id: true, vehicleNumber: true } },
      },
    });

    const data = drivers.map((d) => ({
      id: d.id, name: d.name, phone: d.phone, email: d.email,
      currentVehicleId:     d.assignedVehicle?.id     ?? null,
      currentVehicleNumber: d.assignedVehicle?.vehicleNumber ?? null,
    }));

    res.json({ success: true, data });
  } catch (err) { next(err); }
});

module.exports = router;
