'use strict';

// One-off: store distance_km for completed trips that finished before distances were recorded.
// Safe to rerun, it only touches trips where distance_km is still NULL.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const prisma = require('../src/db/client');
const { tripDistanceKm } = require('../src/lib/tripDistance');

(async () => {
  const trips = await prisma.trip.findMany({ where: { status: 'completed', distanceKm: null }, select: { id: true, institutionId: true } });
  for (const t of trips) {
    await prisma.trip.update({ where: { id: t.id }, data: { distanceKm: await tripDistanceKm(t.id, t.institutionId) } });
  }
  console.log(`Backfilled ${trips.length} trip(s).`);
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
