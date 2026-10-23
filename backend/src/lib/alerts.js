'use strict';

/**
 * Alerts for tracked people: SOS, low battery, leaving or entering a safe zone, and going silent.
 * Every rule fires on a change of state, so a person who stays outside a zone alerts once, not every report.
 * Delivery is in-app (notifications table + the live `notification.new` event).
 * shortcut: in-app only; add SMS/push delivery inside notify() when a gateway account exists.
 */

const prisma = require('../db/client');
const { emitToUser } = require('../ws/server');
const { tripDistanceKm } = require('./tripDistance');

const LOW_BATTERY_PCT = 20;

/** Authority users of the tenant plus the asset's guardians. */
async function recipientIds(institutionId, assetId) {
  const [authorities, guardians] = await Promise.all([
    prisma.user.findMany({ where: { institutionId, userRoles: { some: { role: { name: 'AUTHORITY' } } } }, select: { id: true } }),
    prisma.guardianship.findMany({ where: { institutionId, assetId }, select: { userId: true } }),
  ]);
  return [...new Set([...authorities.map((u) => u.id), ...guardians.map((g) => g.userId)])];
}

async function notify(institutionId, assetId, title, message) {
  for (const userId of await recipientIds(institutionId, assetId)) {
    const n = await prisma.notification.create({ data: { institutionId, userId, title, message } });
    emitToUser(userId, 'notification.new', { id: n.id, title: n.title, message: n.message, isRead: n.isRead, createdAt: n.createdAt });
  }
}

function metersBetween(lat1, lng1, lat2, lng2) {
  const rad = (x) => (x * Math.PI) / 180, R = 6371000;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * asset: { id, institutionId, name }; prev: latest position row before this write (or null);
 * point: the newest point just stored. Returns the alert titles raised (for tests and logs).
 */
async function evaluate(asset, prev, point) {
  const raised = [];
  const raise = async (title, message) => { raised.push(title); await notify(asset.institutionId, asset.id, title, message); };

  if (point.attrs?.sos && !prev?.attrs?.sos) await raise(`SOS from ${asset.name}`, `${asset.name} pressed the SOS button.`);
  if (point.battery != null && point.battery < LOW_BATTERY_PCT && (prev?.battery_pct == null || prev.battery_pct >= LOW_BATTERY_PCT)) {
    await raise(`Low battery: ${asset.name}`, `${asset.name}'s device is at ${Math.round(point.battery)}%.`);
  }

  const zones = await prisma.geofence.findMany({ where: { assetId: asset.id, institutionId: asset.institutionId } });
  for (const z of zones) {
    const inside = metersBetween(z.latitude, z.longitude, point.lat, point.lng) <= z.radiusM;
    if (z.lastInside === inside) continue;
    await prisma.geofence.update({ where: { id: z.id }, data: { lastInside: inside } });
    // The first reading only sets the state; a change afterwards is the alert.
    if (z.lastInside === null) continue;
    await raise(inside ? `${asset.name} arrived: ${z.name}` : `${asset.name} left ${z.name}`,
      inside ? `${asset.name} is back inside the safe zone "${z.name}".` : `${asset.name} has left the safe zone "${z.name}".`);
  }
  return raised;
}

/** Devices of tracked people that have not reported for three intervals (at least 3 minutes). */
async function checkOffline() {
  const rows = await prisma.$queryRaw`
    SELECT d.id, d.asset_id, d.institution_id, a.name
    FROM devices d JOIN assets a ON a.id = d.asset_id AND a.institution_id = d.institution_id
    WHERE d.status = 'active' AND NOT d.offline_alerted AND NOT a.tracking_paused AND d.last_seen_at IS NOT NULL
      AND d.last_seen_at < (now() AT TIME ZONE 'UTC') - make_interval(secs => GREATEST(180, 3 * COALESCE(d.reporting_interval_s, 60)))`;
  for (const r of rows) {
    await prisma.device.update({ where: { id: r.id }, data: { offlineAlerted: true } });
    await notify(r.institution_id, r.asset_id, `No signal: ${r.name}`, `${r.name}'s device has stopped reporting.`);
  }
  return rows.length;
}

/**
 * Delete GPS points past their retention:
 *  - people and things: each asset's own retention_days (written as UTC wall time);
 *  - vehicles: the institution's gps_retention_days (written in the database session's zone, hence plain now()).
 * Points of a trip still in progress are never deleted, and a finished trip gets its distance saved
 * before its points go, so trip lists, fuel and costs keep working.
 */
async function purgeOldPoints() {
  const people = await prisma.$executeRaw`
    DELETE FROM gps_logs g USING assets a
    WHERE g.asset_id = a.id AND g.institution_id = a.institution_id AND g.recorded_at < (now() AT TIME ZONE 'UTC') - make_interval(days => a.retention_days)`;

  // shortcut: up to 200 trips per run; the hourly job catches up on anything left.
  const unsized = await prisma.$queryRaw`
    SELECT DISTINCT t.id, t.institution_id FROM trips t
    JOIN institutions i ON i.id = t.institution_id
    JOIN gps_logs g ON g.trip_id = t.id
    WHERE t.status <> 'in_progress' AND t.distance_km IS NULL AND g.recorded_at < now() - make_interval(days => i.gps_retention_days)
    LIMIT 200`;
  for (const t of unsized) {
    await prisma.trip.update({ where: { id: t.id }, data: { distanceKm: await tripDistanceKm(t.id, t.institution_id) } });
  }

  const vehicles = await prisma.$executeRaw`
    DELETE FROM gps_logs g USING institutions i
    WHERE g.institution_id = i.id AND g.vehicle_id IS NOT NULL
      AND g.recorded_at < now() - make_interval(days => i.gps_retention_days)
      AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.id = g.trip_id AND (t.status = 'in_progress' OR t.distance_km IS NULL))`;
  return people + vehicles;
}

/** Start the periodic jobs. Errors are logged, never thrown, so a bad run cannot stop the server. */
function startAssetJobs() {
  const safe = (fn) => () => fn().catch((e) => console.error('[assetJobs]', e.message));
  setInterval(safe(checkOffline), 60_000).unref();
  setInterval(safe(purgeOldPoints), 60 * 60_000).unref();
  setTimeout(safe(purgeOldPoints), 30_000).unref();   // first clean-up soon after start, not an hour later
}

module.exports = { evaluate, checkOffline, purgeOldPoints, startAssetJobs, notify, metersBetween, LOW_BATTERY_PCT };
