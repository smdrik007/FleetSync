'use strict';

const prisma = require('../db/client');

// shortcut: fixed thresholds, tune with real data.
// The phone reports every 5 s even when parked, so tiny jumps are GPS noise, and a segment that
// implies more than ~150 km/h is a bad fix; both are left out of the total.
const MIN_SEGMENT_M = 5;
const MAX_SPEED_MS = 150 / 3.6;

/**
 * Distance driven on a trip in km (3 decimals), summed over consecutive GPS points at full resolution.
 * `client` is the prisma client or a transaction client; always scoped to the tenant.
 */
async function tripDistanceKm(tripId, institutionId, client = prisma) {
  const [{ metres }] = await client.$queryRaw`
    SELECT COALESCE(SUM(d), 0)::float8 AS metres FROM (
      SELECT ST_Distance(location, LAG(location) OVER w) AS d,
             EXTRACT(EPOCH FROM recorded_at - LAG(recorded_at) OVER w) AS secs
      FROM gps_logs
      WHERE trip_id = ${tripId}::uuid AND institution_id = ${institutionId}::uuid
      WINDOW w AS (ORDER BY recorded_at, id)
    ) s
    WHERE d >= ${MIN_SEGMENT_M} AND (secs <= 0 OR d / secs <= ${MAX_SPEED_MS})`;
  return Math.round(metres) / 1000;
}

module.exports = { tripDistanceKm };
