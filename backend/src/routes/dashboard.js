'use strict';

/**
 * GET /api/v1/fleet/dashboard/summary  (Authority only)
 * One call for every dashboard KPI and chart series. Series are zero-filled, oldest first.
 */

const router = require('express').Router();
const prisma = require('../db/client');
const { authenticate } = require('../middleware/auth');
const { wrap } = require('../lib/http');

const AUTH = authenticate('AUTHORITY');
const DAY = 86400000;
const ONLINE_MS = 5 * 60 * 1000;
const VEHICLE_STATUSES = ['idle', 'on_trip', 'maintenance', 'offline', 'retired'];
const DEVICE_STATUSES  = ['active', 'inactive', 'faulty', 'retired'];

const dayKey = (d) => d.toISOString().slice(0, 10);
const startOfUtcDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const round2 = (n) => Math.round(n * 100) / 100;

router.get('/dashboard/summary', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const now = new Date();
  const today = startOfUtcDay(now);

  const tripsSince   = addDays(today, -13);
  const fuelSince    = addDays(today, -(8 * 7 - 1));
  const maintSince   = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1));

  const [vehicleGroups, devices, activeTrips, recentTrips, fuelRows, maintRows, upcoming, drivers] = await Promise.all([
    prisma.vehicle.groupBy({ by: ['currentStatus'], where: { institutionId }, _count: { _all: true } }),
    prisma.device.findMany({ where: { institutionId }, select: { status: true, lastSeenAt: true } }),
    prisma.trip.count({ where: { institutionId, status: 'in_progress' } }),
    prisma.trip.findMany({ where: { institutionId, startedAt: { gte: tripsSince } }, select: { startedAt: true } }),
    prisma.fuelLog.findMany({ where: { institutionId, logDate: { gte: fuelSince } }, select: { logDate: true, totalCost: true } }),
    prisma.maintenanceRecord.findMany({ where: { institutionId, serviceDate: { gte: maintSince }, status: { not: 'cancelled' }, cost: { not: null } }, select: { serviceDate: true, cost: true } }),
    prisma.maintenanceRecord.findMany({
      where: { institutionId, status: { in: ['scheduled', 'in_progress'] }, serviceDate: { gte: today } },
      include: { vehicle: { select: { vehicleNumber: true } } }, orderBy: { serviceDate: 'asc' }, take: 5,
    }),
    prisma.driver.findMany({
      where: { institutionId, employmentStatus: { not: 'terminated' }, licenseExpiry: { not: null, lte: addDays(today, 30) } },
      select: { id: true, name: true, licenseExpiry: true }, orderBy: { licenseExpiry: 'asc' },
    }),
  ]);

  const vehiclesByStatus = Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, 0]));
  for (const g of vehicleGroups) if (g.currentStatus in vehiclesByStatus) vehiclesByStatus[g.currentStatus] = g._count._all;

  const deviceCounts = Object.fromEntries(DEVICE_STATUSES.map((s) => [s, 0]));
  let online = 0;
  for (const d of devices) {
    if (d.status in deviceCounts) deviceCounts[d.status] += 1;
    if (d.lastSeenAt && now - d.lastSeenAt < ONLINE_MS) online += 1;
  }

  const perDay = new Map(Array.from({ length: 14 }, (_, i) => [dayKey(addDays(tripsSince, i)), 0]));
  for (const t of recentTrips) { const k = dayKey(t.startedAt); if (perDay.has(k)) perDay.set(k, perDay.get(k) + 1); }

  // 8 rolling 7-day buckets ending today; weekStart is the first day of each bucket.
  const weeks = Array.from({ length: 8 }, (_, i) => ({ weekStart: dayKey(addDays(fuelSince, i * 7)), cost: 0 }));
  for (const f of fuelRows) {
    const idx = Math.floor((startOfUtcDay(f.logDate).getTime() - fuelSince.getTime()) / DAY / 7);
    if (idx >= 0 && idx < 8) weeks[idx].cost += Number(f.totalCost);
  }

  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5 + i, 1));
    return { month: dayKey(d).slice(0, 7), cost: 0 };
  });
  for (const m of maintRows) {
    const row = months.find((x) => x.month === dayKey(m.serviceDate).slice(0, 7));
    if (row) row.cost += Number(m.cost);
  }

  const fuelCost30d = fuelRows.filter((f) => f.logDate >= addDays(today, -30)).reduce((a, f) => a + Number(f.totalCost), 0);

  res.json({
    success: true,
    data: {
      totalVehicles: Object.values(vehiclesByStatus).reduce((a, b) => a + b, 0),
      vehiclesByStatus,
      activeTrips,
      devices: { ...deviceCounts, online },
      upcomingMaintenance: upcoming.map((m) => ({ id: m.id, vehicleNumber: m.vehicle.vehicleNumber, description: m.description, serviceDate: m.serviceDate })),
      fuelCost30d: round2(fuelCost30d),
      tripsPerDay: [...perDay].map(([date, count]) => ({ date, count })),
      fuelCostPerWeek: weeks.map((w) => ({ ...w, cost: round2(w.cost) })),
      maintenanceCostByMonth: months.map((m) => ({ ...m, cost: round2(m.cost) })),
      licenseExpiring: drivers.map((d) => ({ driverId: d.id, name: d.name, licenseExpiry: d.licenseExpiry })),
    },
  });
}));

module.exports = router;
