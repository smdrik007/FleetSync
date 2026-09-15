'use strict';

/**
 * FleetSync — Database Seed Script
 * Seeds: 2 Institutions, 2 Authorities, 2+2 Drivers, 1 Passenger per institution, 2+2 Vehicles
 * Run: node src/db/seed.js
 */

require('dotenv').config();
const prisma    = require('./client');
const bcrypt    = require('bcryptjs');

const SALT_ROUNDS = 10;
const hash = (pw) => bcrypt.hashSync(pw, SALT_ROUNDS);

async function main() {
  console.log('🌱 Seeding FleetSync database…\n');

  // ── Institutions ─────────────────────────────────────────────────────
  const ku = await prisma.institution.upsert({
    where:  { slug: 'ku' },
    update: {},
    create: { id: 'ku-001', name: 'Khulna University', slug: 'ku', logoUrl: null },
  });

  const apex = await prisma.institution.upsert({
    where:  { slug: 'apex' },
    update: {},
    create: { id: 'apx-002', name: 'Apex Logistics Co.', slug: 'apex', logoUrl: null },
  });

  console.log(`  ✅ Institutions: ${ku.name}, ${apex.name}`);

  // ── Users — Khulna University ─────────────────────────────────────────
  const kuAuthority = await prisma.user.upsert({
    where:  { institutionId_email: { institutionId: ku.id, email: 'authority@ku.edu.bd' } },
    update: {},
    create: {
      id: 'usr-ku-auth', institutionId: ku.id,
      name: 'Transport Pool (KU)', email: 'authority@ku.edu.bd',
      role: 'AUTHORITY', passwordHash: hash('demo1234'),
    },
  });

  const rahimDriver = await prisma.user.upsert({
    where:  { institutionId_email: { institutionId: ku.id, email: 'rahim@ku.edu.bd' } },
    update: {},
    create: {
      id: 'usr-ku-drv1', institutionId: ku.id,
      name: 'Rahim Uddin', email: 'rahim@ku.edu.bd', phone: '+8801822987654',
      role: 'DRIVER', passwordHash: hash('demo1234'),
    },
  });

  const karimDriver = await prisma.user.upsert({
    where:  { institutionId_email: { institutionId: ku.id, email: 'karim@ku.edu.bd' } },
    update: {},
    create: {
      id: 'usr-ku-drv2', institutionId: ku.id,
      name: 'Karim Hossain', email: 'karim@ku.edu.bd', phone: '+8801711234567',
      role: 'DRIVER', passwordHash: hash('demo1234'),
    },
  });

  await prisma.user.upsert({
    where:  { institutionId_email: { institutionId: ku.id, email: 'passenger@ku.edu.bd' } },
    update: {},
    create: {
      id: 'usr-ku-pass', institutionId: ku.id,
      name: 'Student Passenger', email: 'passenger@ku.edu.bd',
      role: 'PASSENGER', passwordHash: hash('demo1234'),
    },
  });

  // ── Users — Apex Logistics ─────────────────────────────────────────────
  const apexAuthority = await prisma.user.upsert({
    where:  { institutionId_email: { institutionId: apex.id, email: 'authority@apex.com' } },
    update: {},
    create: {
      id: 'usr-apx-auth', institutionId: apex.id,
      name: 'Fleet Manager (Apex)', email: 'authority@apex.com',
      role: 'AUTHORITY', passwordHash: hash('demo1234'),
    },
  });

  const sumonDriver = await prisma.user.upsert({
    where:  { institutionId_email: { institutionId: apex.id, email: 'sumon@apex.com' } },
    update: {},
    create: {
      id: 'usr-apx-drv1', institutionId: apex.id,
      name: 'Sumon Ali', email: 'sumon@apex.com', phone: '+8801900111222',
      role: 'DRIVER', passwordHash: hash('demo1234'),
    },
  });

  const rafiqDriver = await prisma.user.upsert({
    where:  { institutionId_email: { institutionId: apex.id, email: 'rafiq@apex.com' } },
    update: {},
    create: {
      id: 'usr-apx-drv2', institutionId: apex.id,
      name: 'Rafiq Islam', email: 'rafiq@apex.com', phone: '+8801900333444',
      role: 'DRIVER', passwordHash: hash('demo1234'),
    },
  });

  await prisma.user.upsert({
    where:  { institutionId_email: { institutionId: apex.id, email: 'passenger@apex.com' } },
    update: {},
    create: {
      id: 'usr-apx-pass', institutionId: apex.id,
      name: 'Apex Employee', email: 'passenger@apex.com',
      role: 'PASSENGER', passwordHash: hash('demo1234'),
    },
  });

  console.log('  ✅ Users seeded for both institutions');

  // ── Vehicles — Khulna University ──────────────────────────────────────
  await prisma.vehicle.upsert({
    where:  { institutionId_plateNumber: { institutionId: ku.id, plateNumber: 'KH-DHA-11-1001' } },
    update: {},
    create: {
      id: 'veh-ku-01', institutionId: ku.id,
      vehicleNumber: 'Bus #01', plateNumber: 'KH-DHA-11-1001',
      model: 'Tata LPO 1512', capacity: 40,
      currentStatus: 'ACTIVE',
      assignedRoute: 'Sonadanga → Shibbari → KU Main Gate → Campus',
      assignedDriverId: rahimDriver.id,
    },
  });

  await prisma.vehicle.upsert({
    where:  { institutionId_plateNumber: { institutionId: ku.id, plateNumber: 'KH-DHA-11-1002' } },
    update: {},
    create: {
      id: 'veh-ku-02', institutionId: ku.id,
      vehicleNumber: 'Bus #02', plateNumber: 'KH-DHA-11-1002',
      model: 'Tata LPO 1512', capacity: 40,
      currentStatus: 'ACTIVE',
      assignedRoute: 'Boyra → Khalishpur → Campus',
      assignedDriverId: karimDriver.id,
    },
  });

  // ── Vehicles — Apex Logistics ─────────────────────────────────────────
  await prisma.vehicle.upsert({
    where:  { institutionId_plateNumber: { institutionId: apex.id, plateNumber: 'DHK-MET-01-5501' } },
    update: {},
    create: {
      id: 'veh-apx-01', institutionId: apex.id,
      vehicleNumber: 'Van #A1', plateNumber: 'DHK-MET-01-5501',
      model: 'Toyota HiAce', capacity: 12,
      currentStatus: 'ACTIVE',
      assignedRoute: 'Mirpur → Farmgate → Gulshan',
      assignedDriverId: sumonDriver.id,
    },
  });

  await prisma.vehicle.upsert({
    where:  { institutionId_plateNumber: { institutionId: apex.id, plateNumber: 'DHK-MET-01-5502' } },
    update: {},
    create: {
      id: 'veh-apx-02', institutionId: apex.id,
      vehicleNumber: 'Van #A2', plateNumber: 'DHK-MET-01-5502',
      model: 'Toyota HiAce', capacity: 12,
      currentStatus: 'MAINTENANCE',
      assignedRoute: 'Uttara → Airport → Motijheel',
      assignedDriverId: null,
    },
  });

  console.log('  ✅ Vehicles seeded for both institutions');

  console.log('\n🎉 Seed complete!\n');
  console.log('Demo accounts (password: demo1234):\n');
  console.log('  🏫 Khulna University (slug: ku)');
  console.log('     AUTHORITY  → authority@ku.edu.bd');
  console.log('     DRIVER     → rahim@ku.edu.bd | karim@ku.edu.bd');
  console.log('     PASSENGER  → passenger@ku.edu.bd\n');
  console.log('  🏢 Apex Logistics Co. (slug: apex)');
  console.log('     AUTHORITY  → authority@apex.com');
  console.log('     DRIVER     → sumon@apex.com | rafiq@apex.com');
  console.log('     PASSENGER  → passenger@apex.com\n');
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
