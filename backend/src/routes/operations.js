'use strict';

/**
 * Operations: maintenance, fuel logs, notifications.
 * Maintenance / fuel are Authority only. Notifications: any authenticated role reads
 * and marks their OWN; only Authority sends.
 *
 * GET/POST        /api/v1/fleet/maintenance         ?status&vehicleId
 * PUT/DELETE      /api/v1/fleet/maintenance/:id
 * GET/POST        /api/v1/fleet/fuel                ?vehicleId
 * DELETE          /api/v1/fleet/fuel/:id
 * GET             /api/v1/fleet/notifications       ?unread=1
 * POST            /api/v1/fleet/notifications       (authority) { userId, title, message }
 * POST            /api/v1/fleet/notifications/read-all
 * POST            /api/v1/fleet/notifications/:id/read
 */

const router = require('express').Router();
const prisma = require('../db/client');
const { authenticate } = require('../middleware/auth');
const { emitToUser } = require('../ws/server');
const { bad, assertEnum, isUuid, wrap } = require('../lib/http');

const AUTH = authenticate('AUTHORITY');
const ANY  = authenticate();

const MAINT_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];
const vehicleBrief = { select: { id: true, vehicleNumber: true } };

async function assertVehicle(vehicleId, institutionId) {
  const v = isUuid(vehicleId) ? await prisma.vehicle.findFirst({ where: { id: vehicleId, institutionId }, select: { id: true } }) : null;
  if (!v) throw bad(422, 'INVALID_VEHICLE', 'Vehicle not found in your institution.');
}

function toDate(value, field) {
  const d = new Date(value);
  if (value === undefined || value === null || value === '' || Number.isNaN(d.getTime())) throw bad(422, `INVALID_${field.toUpperCase()}`, `${field} must be a valid date.`);
  return d;
}

function positiveNumber(value, field, code) {
  const n = Number(value);
  if (value === undefined || value === null || value === '' || !Number.isFinite(n) || n <= 0) throw bad(422, code, `${field} must be a number greater than zero.`);
  return n;
}

function optionalCost(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw bad(422, 'INVALID_COST', 'cost must be zero or more.');
  return n;
}

// ── Maintenance ──────────────────────────────────────────────────────
const presentMaint = (m) => ({
  id: m.id, vehicle: m.vehicle, description: m.description,
  cost: m.cost === null ? null : Number(m.cost), serviceDate: m.serviceDate, status: m.status, createdAt: m.createdAt,
});

async function ownMaint(id, institutionId) {
  const m = isUuid(id) ? await prisma.maintenanceRecord.findFirst({ where: { id, institutionId } }) : null;
  if (!m) throw bad(404, 'MAINTENANCE_NOT_FOUND', 'Maintenance record not found.');
  return m;
}

router.get('/maintenance', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const { status, vehicleId } = req.query;
  if (status) assertEnum(status, MAINT_STATUSES, 'status');
  if (vehicleId && !isUuid(vehicleId)) return res.json({ success: true, data: [] });
  const rows = await prisma.maintenanceRecord.findMany({
    where: { institutionId, ...(status ? { status } : {}), ...(vehicleId ? { vehicleId } : {}) },
    include: { vehicle: vehicleBrief }, orderBy: { serviceDate: 'desc' },
  });
  res.json({ success: true, data: rows.map(presentMaint) });
}));

router.post('/maintenance', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const { vehicleId, description, serviceDate, cost, status } = req.body;
  if (!description || !String(description).trim()) throw bad(422, 'MISSING_FIELDS', 'description is required.');
  await assertVehicle(vehicleId, institutionId);
  if (status) assertEnum(status, MAINT_STATUSES, 'status');
  const row = await prisma.maintenanceRecord.create({
    data: { institutionId, vehicleId, description: String(description).trim(), serviceDate: toDate(serviceDate, 'serviceDate'), cost: optionalCost(cost), status: status || 'scheduled' },
    include: { vehicle: vehicleBrief },
  });
  res.status(201).json({ success: true, data: presentMaint(row) });
}));

router.put('/maintenance/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  await ownMaint(req.params.id, institutionId);
  const b = req.body;
  const data = {};
  if (b.vehicleId !== undefined) { await assertVehicle(b.vehicleId, institutionId); data.vehicleId = b.vehicleId; }
  if (b.description !== undefined) {
    if (!String(b.description).trim()) throw bad(422, 'MISSING_FIELDS', 'description cannot be empty.');
    data.description = String(b.description).trim();
  }
  if (b.serviceDate !== undefined) data.serviceDate = toDate(b.serviceDate, 'serviceDate');
  if (b.cost !== undefined) data.cost = optionalCost(b.cost);
  if (b.status !== undefined) { assertEnum(b.status, MAINT_STATUSES, 'status'); data.status = b.status; }
  const row = await prisma.maintenanceRecord.update({ where: { id: req.params.id }, data, include: { vehicle: vehicleBrief } });
  res.json({ success: true, data: presentMaint(row) });
}));

router.delete('/maintenance/:id', AUTH, wrap(async (req, res) => {
  await ownMaint(req.params.id, req.user.institutionId);
  await prisma.maintenanceRecord.delete({ where: { id: req.params.id } });
  res.json({ success: true, data: { message: 'Maintenance record deleted.' } });
}));

// ── Fuel ─────────────────────────────────────────────────────────────
const presentFuel = (f) => ({
  id: f.id, vehicle: f.vehicle, loggedBy: f.loggedByUser, volume: Number(f.volume), totalCost: Number(f.totalCost), logDate: f.logDate,
});
const fuelInclude = { vehicle: vehicleBrief, loggedByUser: { select: { id: true, name: true } } };

router.get('/fuel', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const { vehicleId } = req.query;
  if (vehicleId && !isUuid(vehicleId)) return res.json({ success: true, data: [] });
  const rows = await prisma.fuelLog.findMany({
    where: { institutionId, ...(vehicleId ? { vehicleId } : {}) }, include: fuelInclude,
    orderBy: [{ logDate: 'desc' }, { id: 'asc' }],
  });
  res.json({ success: true, data: rows.map(presentFuel) });
}));

router.post('/fuel', AUTH, wrap(async (req, res) => {
  const { institutionId, sub } = req.user;
  const { vehicleId, volume, totalCost, logDate } = req.body;
  await assertVehicle(vehicleId, institutionId);
  const row = await prisma.fuelLog.create({
    data: {
      institutionId, vehicleId, loggedByUserId: sub,
      volume: positiveNumber(volume, 'volume', 'INVALID_VOLUME'), totalCost: positiveNumber(totalCost, 'totalCost', 'INVALID_TOTAL_COST'),
      ...(logDate ? { logDate: toDate(logDate, 'logDate') } : {}),
    },
    include: fuelInclude,
  });
  res.status(201).json({ success: true, data: presentFuel(row) });
}));

router.delete('/fuel/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const row = isUuid(req.params.id) ? await prisma.fuelLog.findFirst({ where: { id: req.params.id, institutionId } }) : null;
  if (!row) throw bad(404, 'FUEL_NOT_FOUND', 'Fuel log not found.');
  await prisma.fuelLog.delete({ where: { id: row.id } });
  res.json({ success: true, data: { message: 'Fuel log deleted.' } });
}));

// ── Notifications ────────────────────────────────────────────────────
const presentNote = (n) => ({ id: n.id, title: n.title, message: n.message, isRead: n.isRead, createdAt: n.createdAt });

router.get('/notifications', ANY, wrap(async (req, res) => {
  const { institutionId, sub } = req.user;
  const mine = { institutionId, userId: sub };
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where: { ...mine, ...(req.query.unread ? { isRead: false } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 }),
    prisma.notification.count({ where: { ...mine, isRead: false } }),
  ]);
  res.json({ success: true, data: { items: items.map(presentNote), unreadCount } });
}));

router.post('/notifications', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const { userId, title, message } = req.body;
  if (!title || !message) throw bad(422, 'MISSING_FIELDS', 'userId, title and message are required.');
  const target = isUuid(userId) ? await prisma.user.findFirst({ where: { id: userId, institutionId }, select: { id: true } }) : null;
  if (!target) throw bad(422, 'INVALID_USER', 'User not found in your institution.');
  const n = await prisma.notification.create({ data: { institutionId, userId, title: String(title), message: String(message) } });
  emitToUser(userId, 'notification.new', presentNote(n));
  res.status(201).json({ success: true, data: presentNote(n) });
}));

router.post('/notifications/read-all', ANY, wrap(async (req, res) => {
  const { institutionId, sub } = req.user;
  const r = await prisma.notification.updateMany({ where: { institutionId, userId: sub, isRead: false }, data: { isRead: true } });
  res.json({ success: true, data: { updated: r.count } });
}));

router.post('/notifications/:id/read', ANY, wrap(async (req, res) => {
  const { institutionId, sub } = req.user;
  const n = isUuid(req.params.id) ? await prisma.notification.findFirst({ where: { id: req.params.id, institutionId, userId: sub } }) : null;
  if (!n) throw bad(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found.');
  const updated = await prisma.notification.update({ where: { id: n.id }, data: { isRead: true } });
  res.json({ success: true, data: presentNote(updated) });
}));

module.exports = router;
