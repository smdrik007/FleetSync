'use strict';

/**
 * Route network (Authority only): routes, ordered route_stops, stops.
 * GET/POST        /api/v1/fleet/routes
 * GET/PUT/DELETE  /api/v1/fleet/routes/:id
 * PUT             /api/v1/fleet/routes/:id/stops   body { stopIds: [] } (ordered)
 * GET/POST        /api/v1/fleet/stops
 * PUT/DELETE      /api/v1/fleet/stops/:id
 */

const router = require('express').Router();
const prisma = require('../db/client');
const { authenticate } = require('../middleware/auth');
const { bad, wrap } = require('../lib/http');
const { emitVehicleEvent } = require('../ws/server');

const AUTH = authenticate('AUTHORITY');

async function ownRoute(id, institutionId) {
  const r = await prisma.route.findFirst({ where: { id, institutionId } });
  if (!r) throw bad(404, 'ROUTE_NOT_FOUND', 'Route not found.');
  return r;
}

async function ownStop(id, institutionId) {
  const s = await prisma.stop.findFirst({ where: { id, institutionId } });
  if (!s) throw bad(404, 'STOP_NOT_FOUND', 'Stop not found.');
  return s;
}

/** Tell the vehicles on a route (and their drivers/passengers) that what they show for it changed. */
async function announceRoute(routeId, institutionId, routeName) {
  const vehicles = await prisma.vehicle.findMany({ where: { institutionId, assignedRouteId: routeId }, select: { id: true, vehicleNumber: true, assignedDriverId: true } });
  for (const v of vehicles) {
    emitVehicleEvent({
      event: 'vehicle.route_updated',
      data: { vehicleId: v.id, vehicleNumber: v.vehicleNumber, assignedRoute: routeName, updatedAt: new Date().toISOString(), institutionId },
      vehicleId: v.id, driverId: v.assignedDriverId, institutionId,
    });
  }
}

/** Route with its ordered stops and assigned vehicles. */
async function routeDetail(id, institutionId) {
  const r = await prisma.route.findFirst({
    where: { id, institutionId },
    include: {
      routeStops: { orderBy: { stopOrder: 'asc' }, include: { stop: true } },
      vehicles: { select: { id: true, vehicleNumber: true } },
    },
  });
  if (!r) throw bad(404, 'ROUTE_NOT_FOUND', 'Route not found.');
  return {
    id: r.id, name: r.name, description: r.description, createdAt: r.createdAt,
    stopCount: r.routeStops.length, vehicleCount: r.vehicles.length,
    stops: r.routeStops.map((rs) => ({ stopId: rs.stopId, name: rs.stop.name, latitude: rs.stop.latitude, longitude: rs.stop.longitude, stopOrder: rs.stopOrder })),
    vehicles: r.vehicles,
  };
}

function coords(body, partial = false) {
  const out = {};
  for (const [field, limit] of [['latitude', 90], ['longitude', 180]]) {
    if (body[field] === undefined) {
      if (!partial) throw bad(422, 'MISSING_FIELDS', 'name, latitude and longitude are required.');
      continue;
    }
    const n = typeof body[field] === 'number' ? body[field] : Number(body[field]);
    if (body[field] === null || body[field] === '' || !Number.isFinite(n) || Math.abs(n) > limit) {
      throw bad(422, `INVALID_${field.toUpperCase()}`, `${field} must be a number between -${limit} and ${limit}.`);
    }
    out[field] = n;
  }
  return out;
}

// ── Routes ───────────────────────────────────────────────────────────
router.get('/routes', AUTH, wrap(async (req, res) => {
  const rows = await prisma.route.findMany({
    where: { institutionId: req.user.institutionId },
    include: { _count: { select: { routeStops: true, vehicles: true } } },
    orderBy: { name: 'asc' },
  });
  res.json({
    success: true,
    data: rows.map((r) => ({ id: r.id, name: r.name, description: r.description, createdAt: r.createdAt, stopCount: r._count.routeStops, vehicleCount: r._count.vehicles })),
  });
}));

router.get('/routes/:id', AUTH, wrap(async (req, res) => {
  res.json({ success: true, data: await routeDetail(req.params.id, req.user.institutionId) });
}));

router.post('/routes', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const { name, description } = req.body;
  if (!name || !String(name).trim()) throw bad(422, 'MISSING_FIELDS', 'name is required.');
  const r = await prisma.route.create({ data: { institutionId, name: String(name).trim(), description: description || null } });
  res.status(201).json({ success: true, data: await routeDetail(r.id, institutionId) });
}));

router.put('/routes/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  await ownRoute(req.params.id, institutionId);
  const data = {};
  if (req.body.name !== undefined) {
    if (!String(req.body.name).trim()) throw bad(422, 'MISSING_FIELDS', 'name cannot be empty.');
    data.name = String(req.body.name).trim();
  }
  if (req.body.description !== undefined) data.description = req.body.description || null;
  const updated = await prisma.route.update({ where: { id: req.params.id }, data });
  if (data.name !== undefined) await announceRoute(updated.id, institutionId, updated.name);
  res.json({ success: true, data: await routeDetail(req.params.id, institutionId) });
}));

router.put('/routes/:id/stops', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const routeId = req.params.id;
  const route = await ownRoute(routeId, institutionId);

  const { stopIds } = req.body;
  const invalid = () => bad(422, 'INVALID_STOPS', 'stopIds must be a non-empty list of distinct stops from your institution.');
  if (!Array.isArray(stopIds) || stopIds.length === 0 || new Set(stopIds).size !== stopIds.length) throw invalid();
  // Non-uuid strings would make Postgres throw; treat them as unknown stops.
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!stopIds.every((s) => typeof s === 'string' && uuid.test(s))) throw invalid();
  const found = await prisma.stop.count({ where: { id: { in: stopIds }, institutionId } });
  if (found !== stopIds.length) throw invalid();

  await prisma.$transaction([
    prisma.routeStop.deleteMany({ where: { routeId } }),
    prisma.routeStop.createMany({ data: stopIds.map((stopId, i) => ({ routeId, stopId, institutionId, stopOrder: i + 1 })) }),
  ]);
  await announceRoute(routeId, institutionId, route.name);
  res.json({ success: true, data: await routeDetail(routeId, institutionId) });
}));

router.delete('/routes/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const routeId = req.params.id;
  await ownRoute(routeId, institutionId);
  const affected = await prisma.vehicle.findMany({ where: { institutionId, assignedRouteId: routeId }, select: { id: true, vehicleNumber: true, assignedDriverId: true } });
  await prisma.$transaction([
    prisma.vehicle.updateMany({ where: { institutionId, assignedRouteId: routeId }, data: { assignedRouteId: null } }),
    prisma.trip.updateMany({ where: { institutionId, routeId }, data: { routeId: null } }),
    prisma.routeStop.deleteMany({ where: { routeId } }),
    prisma.route.delete({ where: { id: routeId } }),
  ]);
  for (const v of affected) {
    emitVehicleEvent({ event: 'vehicle.route_updated', data: { vehicleId: v.id, vehicleNumber: v.vehicleNumber, assignedRoute: null, updatedAt: new Date().toISOString(), institutionId }, vehicleId: v.id, driverId: v.assignedDriverId, institutionId });
  }
  res.json({ success: true, data: { message: 'Route deleted.' } });
}));

// ── Stops ────────────────────────────────────────────────────────────
router.get('/stops', AUTH, wrap(async (req, res) => {
  const rows = await prisma.stop.findMany({
    where: { institutionId: req.user.institutionId },
    include: { _count: { select: { routeStops: true } } },
    orderBy: { name: 'asc' },
  });
  res.json({
    success: true,
    data: rows.map((s) => ({ id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude, createdAt: s.createdAt, routeCount: s._count.routeStops })),
  });
}));

router.post('/stops', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const { name } = req.body;
  if (!name || !String(name).trim()) throw bad(422, 'MISSING_FIELDS', 'name, latitude and longitude are required.');
  const s = await prisma.stop.create({ data: { institutionId, name: String(name).trim(), ...coords(req.body) } });
  res.status(201).json({ success: true, data: { id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude, createdAt: s.createdAt, routeCount: 0 } });
}));

router.put('/stops/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  await ownStop(req.params.id, institutionId);
  const data = coords(req.body, true);
  if (req.body.name !== undefined) {
    if (!String(req.body.name).trim()) throw bad(422, 'MISSING_FIELDS', 'name cannot be empty.');
    data.name = String(req.body.name).trim();
  }
  const s = await prisma.stop.update({ where: { id: req.params.id }, data });
  res.json({ success: true, data: { id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude, createdAt: s.createdAt } });
}));

router.delete('/stops/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  await ownStop(req.params.id, institutionId);
  const used = await prisma.routeStop.count({ where: { stopId: req.params.id } });
  if (used) throw bad(409, 'STOP_IN_USE', `This stop is used by ${used} route(s). Remove it from them first.`);
  await prisma.stop.delete({ where: { id: req.params.id } });
  res.json({ success: true, data: { message: 'Stop deleted.' } });
}));

module.exports = router;
