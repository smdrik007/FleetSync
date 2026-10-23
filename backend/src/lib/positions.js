'use strict';

/**
 * One write path for every tracker. Adapters turn a device's own format into the normalized
 * point below; recordPositions stores it. Units: speed km/h, heading degrees, battery 0-100, ts UTC.
 */

const prisma = require('../db/client');
const { bad } = require('./http');

const MAX_BATCH = 500;
const MAX_FUTURE_MS = 5 * 60 * 1000;               // clock skew allowance
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;       // offline buffer replay window
const KNOTS_TO_KMH = 1.852;

/** Date from ISO text or epoch seconds/milliseconds (number or numeric string). */
function parseTimestamp(v) {
  let d;
  if (typeof v === 'number' || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v))) {
    const n = Number(v);
    d = new Date(n < 1e11 ? n * 1000 : n);   // below 1e11 can only be seconds
  } else if (typeof v === 'string') {
    d = new Date(v);
  }
  if (!d || Number.isNaN(d.getTime())) throw bad(422, 'INVALID_TIMESTAMP', 'ts must be an ISO 8601 time or epoch seconds.');
  const age = Date.now() - d.getTime();
  if (age < -MAX_FUTURE_MS) throw bad(422, 'TIMESTAMP_IN_FUTURE', 'ts is in the future. Send UTC.');
  if (age > MAX_AGE_MS) throw bad(422, 'TIMESTAMP_TOO_OLD', 'ts is older than 14 days.');
  return d;
}

/** Optional number in [min, max]; null when absent. */
function optNum(v, field, min, max) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(422, `INVALID_${field.toUpperCase()}`, `${field} must be a number between ${min} and ${max}.`);
  return n;
}

const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

/**
 * raw: { ts, lat, lng, speed, heading, accuracy, battery, ignition, sos }
 * opts.speedKnots: speed arrives in knots (OsmAnd, Traccar).
 */
function normalizePoint(raw, { speedKnots = false } = {}) {
  const lat = optNum(raw.lat, 'lat', -90, 90);
  const lng = optNum(raw.lng, 'lng', -180, 180);
  if (lat === null || lng === null) throw bad(422, 'MISSING_FIELDS', 'lat and lng are required.');
  const speed = optNum(raw.speed, 'speed', 0, 1000);
  const attrs = {};
  if (truthy(raw.sos)) attrs.sos = true;
  return {
    ts: parseTimestamp(raw.ts),
    lat, lng,
    speed: speed === null ? null : speed * (speedKnots ? KNOTS_TO_KMH : 1),
    heading: optNum(raw.heading, 'heading', 0, 360),
    accuracy: optNum(raw.accuracy, 'accuracy', 0, 1e6),
    battery: optNum(raw.battery, 'battery', 0, 100),
    ignition: raw.ignition === undefined || raw.ignition === null ? null : truthy(raw.ignition),
    attrs: Object.keys(attrs).length ? attrs : null,
  };
}

/** Sort oldest first and drop repeated timestamps (the same fix sent twice in one batch). */
function prepareBatch(points) {
  if (points.length > MAX_BATCH) throw bad(413, 'BATCH_TOO_LARGE', `Send at most ${MAX_BATCH} points per request.`);
  const byTs = new Map(points.map((p) => [p.ts.getTime(), p]));
  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * Store points for one device. A point already stored for this device and time is skipped, so a
 * device may safely resend its buffer after a lost response.
 * device: { id, institutionId, vehicleId }. Returns how many rows were new.
 */
async function recordPositions(device, tripId, points) {
  if (!points.length) return 0;
  const { id: deviceId, institutionId, vehicleId } = device;
  const json = JSON.stringify(points.map((p) => ({
    ts: p.ts.toISOString(), lat: p.lat, lng: p.lng, accuracy: p.accuracy, speed: p.speed,
    heading: p.heading, ignition: p.ignition, battery: p.battery, attrs: p.attrs,
  })));
  const newest = points[points.length - 1];
  const newestTs = newest.ts.toISOString();
  const newestAttrs = newest.attrs ? JSON.stringify(newest.attrs) : null;

  const [inserted] = await prisma.$transaction([
    prisma.$executeRaw`
      INSERT INTO gps_logs
        (recorded_at, institution_id, vehicle_id, device_id, trip_id, location, accuracy, speed, heading, ignition_on, battery_pct, attrs, received_at)
      SELECT p.ts, ${institutionId}::uuid, ${vehicleId}::uuid, ${deviceId}::uuid, ${tripId}::uuid,
             ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326), p.accuracy, p.speed, p.heading, p.ignition, p.battery, p.attrs, now()
      FROM jsonb_to_recordset(${json}::jsonb)
        AS p(ts timestamptz, lat float8, lng float8, accuracy float8, speed float8, heading float8, ignition boolean, battery float8, attrs jsonb)
      WHERE NOT EXISTS (
        SELECT 1 FROM gps_logs g WHERE g.vehicle_id = ${vehicleId}::uuid AND g.device_id = ${deviceId}::uuid AND g.recorded_at = p.ts)`,
    // Latest position only moves forward in time, so replayed old points never rewind the map.
    prisma.$executeRaw`
      INSERT INTO vehicle_latest_position
        (vehicle_id, institution_id, device_id, trip_id, location, speed, heading, ignition_on, battery_pct, attrs, recorded_at, updated_at)
      VALUES (${vehicleId}::uuid, ${institutionId}::uuid, ${deviceId}::uuid, ${tripId}::uuid,
              ST_SetSRID(ST_MakePoint(${newest.lng}, ${newest.lat}), 4326), ${newest.speed}, ${newest.heading},
              ${newest.ignition}, ${newest.battery}, ${newestAttrs}::jsonb, ${newestTs}::timestamptz, now())
      ON CONFLICT (vehicle_id) DO UPDATE SET
        device_id = EXCLUDED.device_id, trip_id = EXCLUDED.trip_id, location = EXCLUDED.location,
        speed = EXCLUDED.speed, heading = EXCLUDED.heading, ignition_on = EXCLUDED.ignition_on,
        battery_pct = EXCLUDED.battery_pct, attrs = EXCLUDED.attrs,
        recorded_at = EXCLUDED.recorded_at, updated_at = now()
      WHERE vehicle_latest_position.recorded_at < EXCLUDED.recorded_at`,
    // Only the reporting device is "seen", unlike the old per-vehicle update.
    prisma.$executeRaw`
      UPDATE devices SET last_seen_at = now(), last_battery_pct = COALESCE(${newest.battery}::float8, last_battery_pct)
      WHERE id = ${deviceId}::uuid AND institution_id = ${institutionId}::uuid`,
  ]);
  return inserted;
}

/**
 * Same as recordPositions for a tracked person or equipment. Also returns the latest position as it was
 * before this write (null the first time), which the alert rules compare against.
 * Times are written as UTC wall time: the timestamp columns carry no zone and the database session runs
 * in Asia/Dhaka, so a plain now() or timestamptz cast would read back 6 hours ahead (the vehicle path has that quirk).
 */
async function recordAssetPositions(device, assetId, points) {
  if (!points.length) return { stored: 0, prev: null };
  const { id: deviceId, institutionId } = device;
  const json = JSON.stringify(points.map((p) => ({
    ts: p.ts.toISOString(), lat: p.lat, lng: p.lng, accuracy: p.accuracy, speed: p.speed,
    heading: p.heading, ignition: p.ignition, battery: p.battery, attrs: p.attrs,
  })));
  const newest = points[points.length - 1];
  const newestTs = newest.ts.toISOString();
  const newestAttrs = newest.attrs ? JSON.stringify(newest.attrs) : null;

  const [prevRows, inserted] = await prisma.$transaction([
    prisma.$queryRaw`SELECT battery_pct, attrs FROM asset_latest_position WHERE asset_id = ${assetId}::uuid`,
    prisma.$executeRaw`
      INSERT INTO gps_logs
        (recorded_at, institution_id, asset_id, device_id, location, accuracy, speed, heading, ignition_on, battery_pct, attrs, received_at)
      SELECT (p.ts AT TIME ZONE 'UTC'), ${institutionId}::uuid, ${assetId}::uuid, ${deviceId}::uuid,
             ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326), p.accuracy, p.speed, p.heading, p.ignition, p.battery, p.attrs, now()
      FROM jsonb_to_recordset(${json}::jsonb)
        AS p(ts timestamptz, lat float8, lng float8, accuracy float8, speed float8, heading float8, ignition boolean, battery float8, attrs jsonb)
      WHERE NOT EXISTS (
        SELECT 1 FROM gps_logs g WHERE g.asset_id = ${assetId}::uuid AND g.device_id = ${deviceId}::uuid AND g.recorded_at = (p.ts AT TIME ZONE 'UTC'))`,
    prisma.$executeRaw`
      INSERT INTO asset_latest_position
        (asset_id, institution_id, device_id, location, speed, heading, battery_pct, attrs, recorded_at, updated_at)
      VALUES (${assetId}::uuid, ${institutionId}::uuid, ${deviceId}::uuid,
              ST_SetSRID(ST_MakePoint(${newest.lng}, ${newest.lat}), 4326), ${newest.speed}, ${newest.heading},
              ${newest.battery}, ${newestAttrs}::jsonb, (${newestTs}::timestamptz AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
      ON CONFLICT (asset_id) DO UPDATE SET
        device_id = EXCLUDED.device_id, location = EXCLUDED.location, speed = EXCLUDED.speed, heading = EXCLUDED.heading,
        battery_pct = EXCLUDED.battery_pct, attrs = EXCLUDED.attrs, recorded_at = EXCLUDED.recorded_at, updated_at = (now() AT TIME ZONE 'UTC')
      WHERE asset_latest_position.recorded_at < EXCLUDED.recorded_at`,
    // Reporting again also clears a "no signal" alert so the next silence alerts afresh.
    prisma.$executeRaw`
      UPDATE devices SET last_seen_at = (now() AT TIME ZONE 'UTC'), offline_alerted = false, last_battery_pct = COALESCE(${newest.battery}::float8, last_battery_pct)
      WHERE id = ${deviceId}::uuid AND institution_id = ${institutionId}::uuid`,
  ]);
  return { stored: inserted, prev: prevRows[0] || null };
}

module.exports = { MAX_BATCH, parseTimestamp, normalizePoint, prepareBatch, recordPositions, recordAssetPositions };
