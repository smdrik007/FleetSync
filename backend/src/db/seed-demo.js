'use strict';

/**
 * Demo data for every ER view: stops/routes, devices, trips + GPS trails,
 * maintenance, fuel, notifications, permissions and subscriptions.
 * Idempotent: fixed ids + upserts, and "skip if already present" for logs.
 * Called from seed.js after the core tenancy/fleet rows exist.
 */

const DAY = 86400000;
const pad = (n) => String(n).padStart(12, '0');
const uid = (group, n) => `00000000-0000-4000-${group}-${pad(n)}`;
const daysFromNow = (d) => new Date(Date.now() + d * DAY);
const dateOnly = (d) => new Date(daysFromNow(d).toISOString().slice(0, 10));

const PERMISSIONS = [
  ['vehicles.read', 'View vehicles and live positions'],
  ['vehicles.manage', 'Create, edit and retire vehicles'],
  ['drivers.manage', 'Manage driver records and assignments'],
  ['trips.read', 'View trips and GPS history'],
  ['trips.manage', 'Start, end and cancel trips'],
  ['reports.read', 'View dashboards and reports'],
];
const ROLE_PERMS = {
  AUTHORITY: PERMISSIONS.map((p) => p[0]),
  DRIVER: ['vehicles.read', 'trips.read', 'trips.manage'],
  PASSENGER: ['vehicles.read', 'trips.read'],
};

// Per-tenant geography. Stop coordinates trace a plausible path used for GPS trails.
const TENANTS = {
  ku: {
    stops: [
      ['Sonadanga', 22.8030, 89.5380], ['Shibbari', 22.8190, 89.5360], ['Boyra', 22.8330, 89.5300],
      ['Khalishpur', 22.8450, 89.5600], ['KU Main Gate', 22.8890, 89.5070], ['KU Campus', 22.8990, 89.5000],
    ],
    routes: [
      { id: 'e000-1', name: 'Sonadanga → Shibbari → KU Main Gate → Campus', stops: [0, 1, 4, 5] },
      { id: 'e000-2', name: 'Boyra → Khalishpur → Campus', stops: [2, 3, 5] },
    ],
  },
  apex: {
    stops: [
      ['Mirpur 10', 23.8069, 90.3687], ['Farmgate', 23.7561, 90.3872], ['Gulshan 1', 23.7925, 90.4078],
      ['Uttara', 23.8759, 90.3795], ['Airport', 23.8513, 90.4000], ['Motijheel', 23.7330, 90.4172],
    ],
    routes: [
      { id: 'e000-3', name: 'Mirpur → Farmgate → Gulshan', stops: [0, 1, 2] },
      { id: 'e000-4', name: 'Uttara → Airport → Motijheel', stops: [3, 4, 5] },
    ],
  },
};

/** n points interpolated along the polyline through the given [lat,lng] pairs. */
function trail(points, n) {
  const segs = points.length - 1;
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * segs;
    const s = Math.min(Math.floor(t), segs - 1);
    const f = t - s;
    const [la, lo] = points[s];
    const [lb, lb2] = points[s + 1];
    return { lat: la + (lb - la) * f, lng: lo + (lb2 - lo) * f };
  });
}

function heading(a, b) {
  return (Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180 / Math.PI + 360) % 360;
}

async function seedPermissions(prisma) {
  const perms = {};
  for (const [code, description] of PERMISSIONS) {
    perms[code] = await prisma.permission.upsert({ where: { code }, update: { description }, create: { code, description } });
  }
  const roles = await prisma.role.findMany();
  for (const role of roles) {
    for (const code of ROLE_PERMS[role.name] || []) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perms[code].id } },
        update: {}, create: { roleId: role.id, permissionId: perms[code].id },
      });
    }
  }
}

async function seedTenant(prisma, key, t) {
  const { inst, vehicles, drivers, authorityUserId, userIds } = t;
  const geo = TENANTS[key];
  const iid = inst.id;
  const slot = key === 'ku' ? 1 : 2; // keeps ids unique across tenants

  // ── Subscription ───────────────────────────────────────────────
  if (!(await prisma.subscription.count({ where: { institutionId: iid } }))) {
    await prisma.subscription.create({
      data: { institutionId: iid, planName: 'Professional', status: 'active', startDate: dateOnly(-90), endDate: dateOnly(275) },
    });
  }

  // ── Stops + route_stops ────────────────────────────────────────
  const stopIds = [];
  for (let i = 0; i < geo.stops.length; i++) {
    const [name, latitude, longitude] = geo.stops[i];
    const id = uid('a100', slot * 100 + i);
    stopIds.push(id);
    await prisma.stop.upsert({ where: { id }, update: {}, create: { id, institutionId: iid, name, latitude, longitude } });
  }
  for (const r of geo.routes) {
    const routeId = uid(r.id.split('-')[0], Number(r.id.split('-')[1]));
    const route = await prisma.route.findUnique({ where: { id: routeId } });
    if (!route) continue; // core seed creates the routes
    await prisma.routeStop.deleteMany({ where: { routeId } });
    await prisma.routeStop.createMany({
      data: r.stops.map((si, order) => ({ routeId, stopId: stopIds[si], institutionId: iid, stopOrder: order + 1 })),
    });
  }

  // ── Devices (one per vehicle) ──────────────────────────────────
  const deviceStates = key === 'ku'
    ? [['active', 1], ['active', 0.2]]            // minutes since last seen
    : [['active', 120], ['faulty', 4320]];
  const deviceIds = [];
  for (let i = 0; i < vehicles.length; i++) {
    const [status, minsAgo] = deviceStates[i];
    const id = uid('a200', slot * 100 + i);
    deviceIds.push(id);
    const data = {
      status, lastSeenAt: new Date(Date.now() - minsAgo * 60000),
      firmwareVersion: i % 2 ? '2.3.1' : '2.4.0',
    };
    await prisma.device.upsert({
      where: { id }, update: data,
      create: {
        id, institutionId: iid, vehicleId: vehicles[i].id, deviceType: 'GPS Tracker',
        imei: `8600000000${slot}${String(i).padStart(4, '0')}`, simIccid: `8988000000000${slot}${i}`,
        installedAt: daysFromNow(-120), ...data,
      },
    });
  }

  // ── Driver detail (license expiry etc.) ────────────────────────
  for (let i = 0; i < drivers.length; i++) {
    const login = drivers[i].userId ? await prisma.user.findUnique({ where: { id: drivers[i].userId }, select: { phone: true } }) : null;
    await prisma.driver.update({
      where: { id: drivers[i].id },
      data: {
        phone: login?.phone ?? drivers[i].phone,
        employeeCode: `EMP-${slot}${String(i + 1).padStart(3, '0')}`, licenseClass: 'Heavy',
        licenseExpiry: dateOnly(i === 0 ? 10 : 400 + i * 30), hiredAt: dateOnly(-700 - i * 120),
      },
    });
  }

  // ── Trips + GPS trails (only on first run) ─────────────────────
  if (!(await prisma.trip.findUnique({ where: { id: uid('a300', slot * 100) } }))) {
    const routeIds = geo.routes.map((r) => uid(r.id.split('-')[0], Number(r.id.split('-')[1])));
    const pts = geo.routes.map((r) => r.stops.map((si) => [geo.stops[si][1], geo.stops[si][2]]));
    // Completed trips: [daysAgo, vehicleIdx, driverIdx, routeIdx]
    const plan = key === 'ku'
      ? [[13, 0, 0, 0], [9, 1, 1, 1], [6, 0, 0, 0], [3, 1, 1, 1], [1, 0, 0, 0]]
      : [[13, 0, 0, 0], [9, 0, 1, 1], [6, 0, 0, 0], [3, 0, 1, 1], [1, 0, 0, 0]];
    for (let n = 0; n < plan.length; n++) {
      const [ago, vi, di, ri] = plan[n];
      const tripId = uid('a300', slot * 100 + n);
      const start = new Date(daysFromNow(-ago).setHours(7, 30, 0, 0));
      const points = trail(pts[ri], 24);
      await prisma.trip.create({
        data: {
          id: tripId, institutionId: iid, vehicleId: vehicles[vi].id, driverId: drivers[di].id, routeId: routeIds[ri],
          status: 'completed', startedAt: start, endedAt: new Date(start.getTime() + points.length * 120000),
        },
      });
      for (let p = 0; p < points.length; p++) {
        const when = new Date(start.getTime() + p * 120000).toISOString();
        const hd = heading(points[p], points[Math.min(p + 1, points.length - 1)]);
        await prisma.$executeRaw`
          INSERT INTO gps_logs (recorded_at, institution_id, vehicle_id, device_id, trip_id, location, accuracy, speed, heading, ignition_on)
          VALUES (${when}::timestamptz, ${iid}::uuid, ${vehicles[vi].id}::uuid, ${deviceIds[vi]}::uuid, ${tripId}::uuid,
                  ST_SetSRID(ST_MakePoint(${points[p].lng}, ${points[p].lat}), 4326)::geography,
                  8, ${28 + (p % 5) * 4}, ${hd}, true)`;
      }
    }
    // One trip in progress, with a live position (unless a real one already exists)
    const liveV = key === 'ku' ? 1 : 0; const liveD = key === 'ku' ? 1 : 1; const liveR = key === 'ku' ? 1 : 0;
    if (!(await prisma.trip.count({ where: { institutionId: iid, status: 'in_progress' } }))) {
      const liveId = uid('a300', slot * 100 + 50);
      await prisma.trip.create({ data: { id: liveId, institutionId: iid, vehicleId: vehicles[liveV].id, driverId: drivers[liveD].id, routeId: routeIds[liveR], status: 'in_progress', startedAt: new Date(Date.now() - 25 * 60000) } });
      await prisma.vehicle.update({ where: { id: vehicles[liveV].id }, data: { currentStatus: 'on_trip' } });
    }
  }

  // Refresh the live position on every run so the demo map is "fresh"
  const live = await prisma.trip.findFirst({ where: { institutionId: iid, status: 'in_progress' }, orderBy: { startedAt: 'desc' } });
  if (live) {
    const vi = vehicles.findIndex((v) => v.id === live.vehicleId);
    const ri = geo.routes.findIndex((r) => uid(r.id.split('-')[0], Number(r.id.split('-')[1])) === live.routeId);
    const mid = trail(geo.routes[Math.max(ri, 0)].stops.map((si) => [geo.stops[si][1], geo.stops[si][2]]), 3)[1];
    await prisma.$executeRaw`
      INSERT INTO vehicle_latest_position (vehicle_id, institution_id, device_id, trip_id, location, speed, heading, ignition_on, recorded_at, updated_at)
      VALUES (${live.vehicleId}::uuid, ${iid}::uuid, ${deviceIds[vi]}::uuid, ${live.id}::uuid,
              ST_SetSRID(ST_MakePoint(${mid.lng}, ${mid.lat}), 4326)::geography, 32, 45, true, now(), now())
      ON CONFLICT (vehicle_id) DO UPDATE SET recorded_at = now(), updated_at = now(), trip_id = EXCLUDED.trip_id`;
  }

  // ── Maintenance ────────────────────────────────────────────────
  if (!(await prisma.maintenanceRecord.count({ where: { institutionId: iid } }))) {
    const m = [
      ['Engine oil and filter change', 4500, -20, 'completed', 0], ['Brake pad replacement', 12800, -8, 'completed', 1],
      ['Tyre rotation and alignment', 3200, 3, 'scheduled', 0], ['Annual fitness inspection', null, 10, 'scheduled', 1],
      ['Air conditioning service', 6100, 0, 'in_progress', key === 'ku' ? 0 : 1],
    ];
    for (const [description, cost, off, status, vi] of m) {
      await prisma.maintenanceRecord.create({ data: { institutionId: iid, vehicleId: vehicles[vi].id, description, cost, serviceDate: dateOnly(off), status } });
    }
  }

  // ── Fuel logs (8 weeks) ────────────────────────────────────────
  if (!(await prisma.fuelLog.count({ where: { institutionId: iid } }))) {
    for (let w = 0; w < 9; w++) {
      const volume = 38 + (w * 7) % 22;
      await prisma.fuelLog.create({
        data: { institutionId: iid, vehicleId: vehicles[w % vehicles.length].id, loggedByUserId: authorityUserId, volume, totalCost: Math.round(volume * 112 * 100) / 100, logDate: dateOnly(-w * 7 - 1) },
      });
    }
  }

  // ── Notifications ──────────────────────────────────────────────
  if (!(await prisma.notification.count({ where: { institutionId: iid } }))) {
    const msgs = [
      ['Welcome to FleetSync', 'Your account is ready. Explore the dashboard to get started.', true],
      ['Service reminder', 'A vehicle has maintenance scheduled within the next 7 days.', false],
      ['License expiry', 'A driver license expires within 30 days. Review the Drivers page.', false],
    ];
    for (const userId of userIds) {
      for (const [title, message, isRead] of msgs) {
        await prisma.notification.create({ data: { institutionId: iid, userId, title, message, isRead } });
      }
    }
  }
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ ku:object, apex:object }} ctx each tenant: { inst, vehicles[], drivers[], authorityUserId, userIds[] }
 */
async function seedDemo(prisma, ctx) {
  await seedPermissions(prisma);
  await seedTenant(prisma, 'ku', ctx.ku);
  await seedTenant(prisma, 'apex', ctx.apex);
  console.log('  ✅ Demo data: stops, devices, trips, GPS trails, maintenance, fuel, notifications, permissions');
}

module.exports = { seedDemo };
