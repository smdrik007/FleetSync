'use strict';

const prisma = require('../db/client');

/**
 * Ordered stops for a set of routes, as Map<routeId, [{ name, latitude, longitude, stopOrder }]>.
 * Used by the driver and passenger apps to draw the real route (route_stops) instead of
 * parsing the route's display name.
 */
async function stopsByRoute(routeIds) {
  const ids = [...new Set(routeIds.filter(Boolean))];
  const out = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return out;
  const rows = await prisma.routeStop.findMany({
    where: { routeId: { in: ids } },
    orderBy: [{ routeId: 'asc' }, { stopOrder: 'asc' }],
    include: { stop: { select: { name: true, latitude: true, longitude: true } } },
  });
  for (const r of rows) out.get(r.routeId).push({ name: r.stop.name, latitude: r.stop.latitude, longitude: r.stop.longitude, stopOrder: r.stopOrder });
  return out;
}

module.exports = { stopsByRoute };
