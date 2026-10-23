'use strict';

/** Read model for tracked people, shared by the authority routes and the guardian page. */

const prisma = require('../db/client');
const { Prisma } = require('@prisma/client');
const { bad, isUuid } = require('./http');

const STALE_MS = 5 * 60 * 1000;
const staleAfter = (intervalS) => Math.max(STALE_MS, 3000 * (intervalS || 0));

/** assets: Asset rows with devices, geofences and guardianships(user) included. */
async function presentAssets(institutionId, assets, { withGuardians = false } = {}) {
  const ids = assets.map((a) => a.id);
  const rows = ids.length ? await prisma.$queryRaw`
    SELECT asset_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, speed, battery_pct, attrs, recorded_at
    FROM asset_latest_position WHERE institution_id = ${institutionId}::uuid AND asset_id = ANY(${ids}::uuid[])` : [];
  const latest = new Map(rows.map((r) => [r.asset_id, r]));

  return assets.map((a) => {
    const d = a.devices[0] || null;   // one device per person for now
    const p = latest.get(a.id);
    const limit = staleAfter(d?.reportingIntervalS);
    return {
      id: a.id, kind: a.kind, name: a.name, code: a.code, notes: a.notes,
      consentAt: a.consentAt, consentBy: a.consentBy, trackingPaused: a.trackingPaused, retentionDays: a.retentionDays,
      device: d && {
        id: d.id, imei: d.imei, deviceType: d.deviceType, status: d.status, lastSeenAt: d.lastSeenAt,
        batteryPct: d.lastBatteryPct, reportingIntervalS: d.reportingIntervalS,
        isOnline: !!d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < limit,
      },
      position: p ? {
        lat: p.lat, lng: p.lng, speed: p.speed, batteryPct: p.battery_pct, sos: !!p.attrs?.sos,
        recordedAt: p.recorded_at, isStale: Date.now() - new Date(p.recorded_at).getTime() > limit,
      } : null,
      geofences: a.geofences.map((z) => ({ id: z.id, name: z.name, latitude: z.latitude, longitude: z.longitude, radiusM: z.radiusM, lastInside: z.lastInside })),
      ...(withGuardians ? { guardians: a.guardianships.map((g) => ({ id: g.user.id, name: g.user.name, email: g.user.email, relationship: g.relationship })) } : {}),
    };
  });
}

const assetInclude = {
  devices: { orderBy: { createdAt: 'asc' } },
  geofences: { orderBy: { createdAt: 'asc' } },
  guardianships: { include: { user: { select: { id: true, name: true, email: true } } } },
};

/** Recent trail for the map: oldest first, thinned to at most 500 points. */
async function trail(institutionId, assetId, hours) {
  const rows = await prisma.$queryRaw`
    SELECT lat, lng, recorded_at FROM (
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, recorded_at,
             row_number() OVER (ORDER BY recorded_at, id) AS rn, count(*) OVER () AS n
      FROM gps_logs WHERE asset_id = ${assetId}::uuid AND institution_id = ${institutionId}::uuid
        AND recorded_at > (now() AT TIME ZONE 'UTC') - make_interval(hours => ${hours}::int)
    ) t WHERE (t.rn - 1) % GREATEST(1, CEIL(t.n / 500.0)::int) = 0 ORDER BY recorded_at`;
  return rows.map((r) => ({ lat: r.lat, lng: r.lng, recordedAt: r.recorded_at }));
}

/** Validate and store a circular safe zone for an asset already checked to belong to the caller. */
async function createZone(institutionId, assetId, body) {
  const lat = Number(body.latitude), lng = Number(body.longitude), radius = Number(body.radiusM);
  if (!body.name || !String(body.name).trim()) throw bad(422, 'MISSING_FIELDS', 'name is required.');
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) throw bad(422, 'INVALID_LATITUDE', 'latitude must be a number between -90 and 90.');
  if (!Number.isFinite(lng) || Math.abs(lng) > 180) throw bad(422, 'INVALID_LONGITUDE', 'longitude must be a number between -180 and 180.');
  if (!Number.isInteger(radius) || radius < 20 || radius > 50000) throw bad(422, 'INVALID_RADIUSM', 'radiusM must be a whole number of metres from 20 to 50000.');
  return prisma.geofence.create({ data: { institutionId, assetId, name: String(body.name).trim(), latitude: lat, longitude: lng, radiusM: radius } });
}

async function deleteZone(institutionId, assetId, zoneId) {
  const r = isUuid(zoneId) ? await prisma.geofence.deleteMany({ where: { id: zoneId, assetId, institutionId } }) : { count: 0 };
  if (!r.count) throw bad(404, 'ZONE_NOT_FOUND', 'Safe zone not found.');
}

module.exports = { presentAssets, assetInclude, trail, createZone, deleteZone, Prisma };
