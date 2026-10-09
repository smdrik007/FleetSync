'use strict';

/**
 * FleetSync — Database Seed Script (v2.0)
 * Seeds: 2 Institutions, Roles, Users, Drivers, Routes, Vehicles
 * Aligned with fleetsync_schema.sql v2.0 (lowercase status values)
 * Run: node src/db/seed.js
 */

require('dotenv').config();
const prisma    = require('./client');
const bcrypt    = require('bcryptjs');
const { seedDemo } = require('./seed-demo');

const SALT_ROUNDS = 10;
const hash = (pw) => bcrypt.hashSync(pw, SALT_ROUNDS);

async function main() {
  console.log('🌱 Seeding FleetSync database (v2.0)…\n');

  // ── Institutions ─────────────────────────────────────────────────────
  const ku = await prisma.institution.upsert({
    where:  { slug: 'ku' },
    update: {},
    create: { id: '00000000-0000-4000-a000-000000000001', name: 'Khulna University', slug: 'ku', logoUrl: null },
  });

  const apex = await prisma.institution.upsert({
    where:  { slug: 'apex' },
    update: {},
    create: { id: '00000000-0000-4000-a000-000000000002', name: 'Apex Logistics Co.', slug: 'apex', logoUrl: null },
  });

  console.log(`  ✅ Institutions: ${ku.name}, ${apex.name}`);

  // ── Roles — Khulna University ─────────────────────────────────────────
  const authorityRole = await prisma.role.upsert({
    where: { uq_roles_name: { institutionId: ku.id, name: 'AUTHORITY' } },
    update: {},
    create: { id: '00000000-0000-4000-a000-000000000001', institutionId: ku.id, name: 'AUTHORITY', description: 'Fleet Manager', isSystem: true },
  });
  const driverRole = await prisma.role.upsert({
    where: { uq_roles_name: { institutionId: ku.id, name: 'DRIVER' } },
    update: {},
    create: { id: '00000000-0000-4000-a000-000000000002', institutionId: ku.id, name: 'DRIVER', description: 'Vehicle Driver', isSystem: true },
  });
  const passengerRole = await prisma.role.upsert({
    where: { uq_roles_name: { institutionId: ku.id, name: 'PASSENGER' } },
    update: {},
    create: { id: '00000000-0000-4000-a000-000000000003', institutionId: ku.id, name: 'PASSENGER', description: 'Passenger', isSystem: true },
  });

  // ── Roles — Apex Logistics ────────────────────────────────────────────
  const authorityRoleApex = await prisma.role.upsert({
    where: { uq_roles_name: { institutionId: apex.id, name: 'AUTHORITY' } },
    update: {},
    create: { id: '00000000-0000-4000-a000-000000000004', institutionId: apex.id, name: 'AUTHORITY', description: 'Fleet Manager', isSystem: true },
  });
  const driverRoleApex = await prisma.role.upsert({
    where: { uq_roles_name: { institutionId: apex.id, name: 'DRIVER' } },
    update: {},
    create: { id: '00000000-0000-4000-a000-000000000005', institutionId: apex.id, name: 'DRIVER', description: 'Vehicle Driver', isSystem: true },
  });
  const passengerRoleApex = await prisma.role.upsert({
    where: { uq_roles_name: { institutionId: apex.id, name: 'PASSENGER' } },
    update: {},
    create: { id: '00000000-0000-4000-a000-000000000006', institutionId: apex.id, name: 'PASSENGER', description: 'Passenger', isSystem: true },
  });

  // ── Users — Khulna University ─────────────────────────────────────────
  // Note: email is globally unique in v2.0 schema (not per-institution)
  const kuAuthority = await prisma.user.upsert({
    where:  { email: 'authority@ku.edu.bd' },
    update: {},
    create: {
      id: '00000000-0000-4000-b000-000000000001', institutionId: ku.id,
      name: 'Transport Pool (KU)', email: 'authority@ku.edu.bd',
      passwordHash: hash('demo1234'),
      userRoles: { create: [{ roleId: authorityRole.id, institutionId: ku.id }] }
    },
  });

  const rahimUser = await prisma.user.upsert({
    where:  { email: 'rahim@ku.edu.bd' },
    update: {},
    create: {
      id: '00000000-0000-4000-b000-000000000002', institutionId: ku.id,
      name: 'Rahim Uddin', email: 'rahim@ku.edu.bd', phone: '+8801822987654',
      passwordHash: hash('demo1234'),
      userRoles: { create: [{ roleId: driverRole.id, institutionId: ku.id }] }
    },
  });
  const rahimDriver = await prisma.driver.upsert({
    where: { uq_drivers_license: { institutionId: ku.id, licenseNumber: 'LIC-KU-01' } },
    update: {},
    create: {
      id: '00000000-0000-4000-c000-000000000001',
      institutionId: ku.id, userId: rahimUser.id,
      name: 'Rahim Uddin', licenseNumber: 'LIC-KU-01',
      employmentStatus: 'active',
    }
  });

  const karimUser = await prisma.user.upsert({
    where:  { email: 'karim@ku.edu.bd' },
    update: {},
    create: {
      id: '00000000-0000-4000-b000-000000000003', institutionId: ku.id,
      name: 'Karim Hossain', email: 'karim@ku.edu.bd', phone: '+8801711234567',
      passwordHash: hash('demo1234'),
      userRoles: { create: [{ roleId: driverRole.id, institutionId: ku.id }] }
    },
  });
  const karimDriver = await prisma.driver.upsert({
    where: { uq_drivers_license: { institutionId: ku.id, licenseNumber: 'LIC-KU-02' } },
    update: {},
    create: {
      id: '00000000-0000-4000-c000-000000000002',
      institutionId: ku.id, userId: karimUser.id,
      name: 'Karim Hossain', licenseNumber: 'LIC-KU-02',
      employmentStatus: 'active',
    }
  });

  await prisma.user.upsert({
    where:  { email: 'passenger@ku.edu.bd' },
    update: {},
    create: {
      id: '00000000-0000-4000-b000-000000000004', institutionId: ku.id,
      name: 'Student Passenger', email: 'passenger@ku.edu.bd',
      passwordHash: hash('demo1234'),
      userRoles: { create: [{ roleId: passengerRole.id, institutionId: ku.id }] }
    },
  });

  // ── Users — Apex Logistics ─────────────────────────────────────────────
  const apexAuthority = await prisma.user.upsert({
    where:  { email: 'authority@apex.com' },
    update: {},
    create: {
      id: '00000000-0000-4000-b000-000000000005', institutionId: apex.id,
      name: 'Fleet Manager (Apex)', email: 'authority@apex.com',
      passwordHash: hash('demo1234'),
      userRoles: { create: [{ roleId: authorityRoleApex.id, institutionId: apex.id }] }
    },
  });

  const sumonUser = await prisma.user.upsert({
    where:  { email: 'sumon@apex.com' },
    update: {},
    create: {
      id: '00000000-0000-4000-b000-000000000006', institutionId: apex.id,
      name: 'Sumon Ali', email: 'sumon@apex.com', phone: '+8801900111222',
      passwordHash: hash('demo1234'),
      userRoles: { create: [{ roleId: driverRoleApex.id, institutionId: apex.id }] }
    },
  });
  const sumonDriver = await prisma.driver.upsert({
    where: { uq_drivers_license: { institutionId: apex.id, licenseNumber: 'LIC-APX-01' } },
    update: {},
    create: {
      id: '00000000-0000-4000-c000-000000000003',
      institutionId: apex.id, userId: sumonUser.id,
      name: 'Sumon Ali', licenseNumber: 'LIC-APX-01',
      employmentStatus: 'active',
    }
  });

  const rafiqUser = await prisma.user.upsert({
    where:  { email: 'rafiq@apex.com' },
    update: {},
    create: {
      id: '00000000-0000-4000-b000-000000000007', institutionId: apex.id,
      name: 'Rafiq Islam', email: 'rafiq@apex.com', phone: '+8801900333444',
      passwordHash: hash('demo1234'),
      userRoles: { create: [{ roleId: driverRoleApex.id, institutionId: apex.id }] }
    },
  });
  const rafiqDriver = await prisma.driver.upsert({
    where: { uq_drivers_license: { institutionId: apex.id, licenseNumber: 'LIC-APX-02' } },
    update: {},
    create: {
      id: '00000000-0000-4000-c000-000000000004',
      institutionId: apex.id, userId: rafiqUser.id,
      name: 'Rafiq Islam', licenseNumber: 'LIC-APX-02',
      employmentStatus: 'active',
    }
  });

  await prisma.user.upsert({
    where:  { email: 'passenger@apex.com' },
    update: {},
    create: {
      id: '00000000-0000-4000-b000-000000000008', institutionId: apex.id,
      name: 'Apex Employee', email: 'passenger@apex.com',
      passwordHash: hash('demo1234'),
      userRoles: { create: [{ roleId: passengerRoleApex.id, institutionId: apex.id }] }
    },
  });

  console.log('  ✅ Users & Drivers seeded for both institutions');

  // ── Vehicle Models (global catalog, institution_id IS NULL) ──────────
  const tataModel = await prisma.vehicleModel.upsert({
    where: { id: '00000000-0000-4000-d000-000000000001' },
    update: {},
    create: { id: '00000000-0000-4000-d000-000000000001', make: 'Tata', model: 'LPO 1512', capacity: 40 }
  });
  const hiaceModel = await prisma.vehicleModel.upsert({
    where: { id: '00000000-0000-4000-d000-000000000002' },
    update: {},
    create: { id: '00000000-0000-4000-d000-000000000002', make: 'Toyota', model: 'HiAce', capacity: 12 }
  });

  // ── Routes ──────────────────────────────────────────────────────────
  const route1 = await prisma.route.upsert({
    where: { uq_routes_name: { institutionId: ku.id, name: 'Sonadanga → Shibbari → KU Main Gate → Campus' } },
    update: {},
    create: { id: '00000000-0000-4000-e000-000000000001', institutionId: ku.id, name: 'Sonadanga → Shibbari → KU Main Gate → Campus' }
  });
  const route2 = await prisma.route.upsert({
    where: { uq_routes_name: { institutionId: ku.id, name: 'Boyra → Khalishpur → Campus' } },
    update: {},
    create: { id: '00000000-0000-4000-e000-000000000002', institutionId: ku.id, name: 'Boyra → Khalishpur → Campus' }
  });
  const route3 = await prisma.route.upsert({
    where: { uq_routes_name: { institutionId: apex.id, name: 'Mirpur → Farmgate → Gulshan' } },
    update: {},
    create: { id: '00000000-0000-4000-e000-000000000003', institutionId: apex.id, name: 'Mirpur → Farmgate → Gulshan' }
  });
  const route4 = await prisma.route.upsert({
    where: { uq_routes_name: { institutionId: apex.id, name: 'Uttara → Airport → Motijheel' } },
    update: {},
    create: { id: '00000000-0000-4000-e000-000000000004', institutionId: apex.id, name: 'Uttara → Airport → Motijheel' }
  });

  // ── Vehicles — Khulna University ──────────────────────────────────────
  // currentStatus uses SQL CHECK values: idle | on_trip | maintenance | offline | retired
  await prisma.vehicle.upsert({
    where:  { uq_vehicles_plate: { institutionId: ku.id, plateNumber: 'KH-DHA-11-1001' } },
    update: {},
    create: {
      id: '00000000-0000-4000-f000-000000000001', institutionId: ku.id,
      vehicleNumber: 'Bus #01', plateNumber: 'KH-DHA-11-1001',
      modelId: tataModel.id,
      currentStatus: 'idle',
      assignedRouteId: route1.id,
      assignedDriverId: rahimDriver.id,
    },
  });

  await prisma.vehicle.upsert({
    where:  { uq_vehicles_plate: { institutionId: ku.id, plateNumber: 'KH-DHA-11-1002' } },
    update: {},
    create: {
      id: '00000000-0000-4000-f000-000000000002', institutionId: ku.id,
      vehicleNumber: 'Bus #02', plateNumber: 'KH-DHA-11-1002',
      modelId: tataModel.id,
      currentStatus: 'idle',
      assignedRouteId: route2.id,
      assignedDriverId: karimDriver.id,
    },
  });

  // ── Vehicles — Apex Logistics ─────────────────────────────────────────
  await prisma.vehicle.upsert({
    where:  { uq_vehicles_plate: { institutionId: apex.id, plateNumber: 'DHK-MET-01-5501' } },
    update: {},
    create: {
      id: '00000000-0000-4000-f000-000000000003', institutionId: apex.id,
      vehicleNumber: 'Van #A1', plateNumber: 'DHK-MET-01-5501',
      modelId: hiaceModel.id,
      currentStatus: 'idle',
      assignedRouteId: route3.id,
      assignedDriverId: sumonDriver.id,
    },
  });

  await prisma.vehicle.upsert({
    where:  { uq_vehicles_plate: { institutionId: apex.id, plateNumber: 'DHK-MET-01-5502' } },
    update: {},
    create: {
      id: '00000000-0000-4000-f000-000000000004', institutionId: apex.id,
      vehicleNumber: 'Van #A2', plateNumber: 'DHK-MET-01-5502',
      modelId: hiaceModel.id,
      currentStatus: 'maintenance',
      assignedRouteId: route4.id,
      assignedDriverId: null,
    },
  });

  console.log('  ✅ Vehicles seeded for both institutions');

  // ── Demo data for every ER view ───────────────────────────────────────
  const tenantCtx = async (inst, authorityUser) => ({
    inst,
    authorityUserId: authorityUser.id,
    vehicles: await prisma.vehicle.findMany({ where: { institutionId: inst.id }, orderBy: { vehicleNumber: 'asc' } }),
    drivers:  await prisma.driver.findMany({ where: { institutionId: inst.id }, orderBy: { licenseNumber: 'asc' } }),
    userIds:  (await prisma.user.findMany({ where: { institutionId: inst.id }, select: { id: true } })).map((u) => u.id),
  });
  await seedDemo(prisma, { ku: await tenantCtx(ku, kuAuthority), apex: await tenantCtx(apex, apexAuthority) });

  console.log('\n🎉 Seed complete (v2.0)!\n');
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
