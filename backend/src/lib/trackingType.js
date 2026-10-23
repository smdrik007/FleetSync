'use strict';

/**
 * What an institution tracks decides which features it gets:
 *   vehicle         → fleet screens and APIs (vehicles, drivers, routes, trips, maintenance, fuel, costs)
 *   people / things → people screens and APIs (people, guardians) and no fleet features
 * "things" is treated exactly like "people".
 */

const prisma = require('../db/client');
const { bad } = require('./http');
const { verifyToken } = require('../middleware/auth');

const TRACKING_TYPES = ['vehicle', 'people', 'things'];
const featureOf = (type) => (type === 'vehicle' ? 'fleet' : 'people');

const CACHE_MS = 30_000;
const cache = new Map();   // institutionId -> { type, at }. shortcut: per process; cleared on change here, so a second instance lags up to 30 s

async function trackingTypeOf(institutionId) {
  const hit = cache.get(institutionId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.type;
  const i = await prisma.institution.findUnique({ where: { id: institutionId }, select: { trackingType: true } });
  const type = i?.trackingType || 'vehicle';
  cache.set(institutionId, { type, at: Date.now() });
  return type;
}
const forgetTrackingType = (institutionId) => cache.delete(institutionId);

/** Roles every institution of this type starts with. */
const rolesFor = (type) => (type === 'vehicle' ? ['AUTHORITY', 'DRIVER', 'PASSENGER'] : ['AUTHORITY', 'GUARDIAN']);

// First path segment under /api/v1/fleet that belongs to one feature. Everything else is shared.
const FLEET_ONLY = new Set(['vehicles', 'models', 'drivers', 'routes', 'stops', 'trips', 'positions', 'maintenance', 'fuel', 'costs', 'dashboard']);
const PEOPLE_ONLY = new Set(['people', 'guardians']);

/**
 * Middleware: 403 FEATURE_DISABLED when the signed-in institution's tracking type does not include this feature.
 * `feature` is fixed ('fleet' | 'people') or, with 'by-path', taken from the first path segment.
 * Requests without a valid token pass through; the route's own auth rejects them.
 */
function requireFeature(feature) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      let user;
      try { user = header.startsWith('Bearer ') ? verifyToken(header.slice(7)) : null; } catch { user = null; }
      if (!user) return next();
      let needed = feature;
      if (feature === 'by-path') {
        const seg = req.path.split('/')[1];
        needed = FLEET_ONLY.has(seg) ? 'fleet' : PEOPLE_ONLY.has(seg) ? 'people' : null;
      }
      if (!needed) return next();
      const have = featureOf(await trackingTypeOf(user.institutionId));
      if (have !== needed) {
        throw bad(403, 'FEATURE_DISABLED', needed === 'fleet'
          ? 'Vehicle features are not part of this institution\'s plan (it tracks people or things).'
          : 'People features are not part of this institution\'s plan (it tracks vehicles).');
      }
      next();
    } catch (err) { next(err); }
  };
}

module.exports = { TRACKING_TYPES, featureOf, trackingTypeOf, forgetTrackingType, rolesFor, requireFeature };
