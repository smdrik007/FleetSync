'use strict';
/**
 * Demo people-tracking tenant: "Sunrise Care Home" tracks people. It has an authority, a guardian, and one
 * consented person with a safe zone. Idempotent. Runs from seed.js, or alone: `node src/db/seed-guardian.js`.
 * (Khulna University and Apex track vehicles, so they have no people screens.)
 */
const bcrypt = require('bcryptjs');

const INSTITUTION_ID = '00000000-0000-4000-a000-000000000003';
const PERSON_ID = '00000000-0000-4000-c000-000000000002';

async function seedGuardian(prisma) {
  const institution = await prisma.institution.upsert({
    where: { slug: 'sunrise-care' }, update: {},
    create: { id: INSTITUTION_ID, name: 'Sunrise Care Home', slug: 'sunrise-care', trackingType: 'people' },
  });
  const institutionId = institution.id;
  const role = (name, description) => prisma.role.upsert({
    where: { uq_roles_name: { institutionId, name } }, update: {},
    create: { institutionId, name, description, isSystem: true },
  });
  const authorityRole = await role('AUTHORITY', 'Manages people, guardians and devices');
  const guardianRole = await role('GUARDIAN', 'Follows the people linked to them');
  const passwordHash = bcrypt.hashSync('demo1234', 10);

  await prisma.user.upsert({
    where: { email: 'authority@sunrise.demo' }, update: {},
    create: { institutionId, name: 'Care Manager', email: 'authority@sunrise.demo', passwordHash, userRoles: { create: [{ roleId: authorityRole.id, institutionId }] } },
  });
  const guardian = await prisma.user.upsert({
    where: { email: 'guardian@sunrise.demo' }, update: {},
    create: { institutionId, name: 'Rahima Begum', email: 'guardian@sunrise.demo', passwordHash, userRoles: { create: [{ roleId: guardianRole.id, institutionId }] } },
  });
  await prisma.subscription.upsert({
    where: { id: '00000000-0000-4000-d000-000000000003' }, update: {},
    create: { id: '00000000-0000-4000-d000-000000000003', institutionId, planName: 'Professional', status: 'active' },
  });
  await prisma.asset.upsert({
    where: { id: PERSON_ID }, update: {},
    create: {
      id: PERSON_ID, institutionId, kind: 'person', name: 'Aisha Rahman', code: 'R-1001', notes: 'Demo person',
      consentAt: new Date(), consentBy: 'Family: Rahima Begum',
      geofences: { create: [{ name: 'Care home grounds', latitude: 22.8456, longitude: 89.5403, radiusM: 300 }] },
    },
  });
  await prisma.guardianship.upsert({
    where: { userId_assetId: { userId: guardian.id, assetId: PERSON_ID } }, update: {},
    create: { institutionId, userId: guardian.id, assetId: PERSON_ID, relationship: 'Daughter' },
  });
  console.log('  ✅ Demo people tenant (Sunrise Care Home) seeded');
}

module.exports = { seedGuardian };

if (require.main === module) {
  require('dotenv').config();
  const prisma = require('./client');
  seedGuardian(prisma).catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
