/**
 * Tiny promise cache for reference lists used by pickers and drawers
 * (models, drivers, routes, …). Mutations call invalidate() so pickers never show stale rows.
 */

const cache = new Map(); // key → { at, promise }
const TTL = 15000;

export function cached(key, loader, ttl = TTL) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;
  const promise = loader().catch((err) => { cache.delete(key); throw err; });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

/** Drop cached lists. With no arguments clears everything. */
export function invalidate(...keys) {
  if (!keys.length) cache.clear();
  else keys.forEach((k) => cache.delete(k));
}

const get = (path) => () => Api.get(path);

export const Lists = {
  vehicles:  () => cached('vehicles',  get('/fleet/vehicles')),
  models:    () => cached('models',    get('/fleet/models')),
  drivers:   () => cached('drivers',   get('/fleet/drivers')),
  routes:    () => cached('routes',    get('/fleet/routes')),
  stops:     () => cached('stops',     get('/fleet/stops')),
  devices:   () => cached('devices',   get('/fleet/devices')),
  users:     () => cached('users',     get('/fleet/users')),
  roles:     () => cached('roles',     get('/fleet/roles')),
};

/** What this institution tracks (vehicle | people | things). Set once by main.js before any screen renders. */
export const Tenant = { trackingType: 'vehicle', isFleet: () => Tenant.trackingType === 'vehicle' };

export const VEHICLE_STATUSES = ['idle', 'on_trip', 'maintenance', 'offline', 'retired'];
export const DEVICE_STATUSES = ['active', 'inactive', 'faulty', 'retired'];
export const TRIP_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];
export const EMPLOYMENT_STATUSES = ['active', 'on_leave', 'suspended', 'terminated'];
