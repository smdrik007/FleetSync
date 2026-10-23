'use strict';

/**
 * Next stop and approximate arrival time for a vehicle on a route.
 * Pure functions: stops are [{ name, latitude, longitude }] in route order, points are { lat, lng }.
 */

const ARRIVED_M = 60;            // within this of a stop counts as "at the stop"
const ROAD_FACTOR = 1.3;         // straight line understates road distance in a city
const DEFAULT_KMH = 20;          // when the bus has not moved enough to measure
const MIN_KMH = 8;              // clamp so a crawl or a burst does not give absurd times
const MAX_KMH = 50;

const rad = (x) => (x * Math.PI) / 180;
function metres(a, b) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Distance from p to segment a-b in metres and where along it the nearest point is (t in 0..1). Flat-earth maths is fine at route scale. */
function toSegment(p, a, b) {
  const kx = Math.cos(rad(p.lat)) * 111320, ky = 110540;
  const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky, bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return { d: Math.hypot(ax + t * dx, ay + t * dy), t };
}

/**
 * Average speed in km/h over recent fixes (any order, each { lat, lng, at: Date }); null when it cannot be measured.
 * Distance is summed along the fixes, so a bus that waited at a stop pulls the average down, as it should for an ETA.
 */
function averageSpeedKmh(fixes) {
  if (!fixes || fixes.length < 2) return null;
  const f = [...fixes].sort((x, y) => x.at - y.at);
  const seconds = (f[f.length - 1].at - f[0].at) / 1000;
  if (seconds < 30) return null;
  let m = 0;
  for (let i = 1; i < f.length; i += 1) m += metres(f[i - 1], f[i]);
  return Math.min(MAX_KMH, Math.max(MIN_KMH, (m / seconds) * 3.6));
}

/**
 * Where the bus is on the route and when it reaches the next stop.
 * Returns null when there is nothing to say (fewer than two stops, or the trip has finished at the last stop).
 * { atStop: name|null, next: { name, order, distanceM, etaMinutes }, speedKmh, speedMeasured }
 */
function nextStopEta(stops, pos, speedKmh) {
  const pts = (stops || []).filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude)).map((s) => ({ name: s.name, lat: s.latitude, lng: s.longitude }));
  if (pts.length < 2 || !pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return null;

  const measured = Number.isFinite(speedKmh) && speedKmh > 0;
  const kmh = measured ? Math.min(MAX_KMH, Math.max(MIN_KMH, speedKmh)) : DEFAULT_KMH;

  // Nearest point on the route, by segment.
  let best = { k: 0, d: Infinity, t: 0 };
  for (let k = 0; k < pts.length - 1; k += 1) {
    const s = toSegment(pos, pts[k], pts[k + 1]);
    if (s.d < best.d) best = { k, ...s };
  }

  let nextIdx = best.k + 1;
  if (best.k === 0 && best.t === 0) nextIdx = 0;                                  // before the first stop
  const lastIdx = pts.length - 1;
  const atIdx = pts.findIndex((p) => metres(pos, p) <= ARRIVED_M);
  if (atIdx !== -1) nextIdx = atIdx + 1;                                           // standing at a stop: the next one is what matters
  if (best.k === lastIdx - 1 && best.t === 1 && atIdx === -1) return null;        // past the end of the route
  if (nextIdx > lastIdx) return { atStop: pts[atIdx].name, next: null, speedKmh: kmh, speedMeasured: measured };   // at the final stop

  const distanceM = Math.round(metres(pos, pts[nextIdx]) * ROAD_FACTOR);
  return {
    atStop: atIdx === -1 ? null : pts[atIdx].name,
    next: { name: pts[nextIdx].name, order: nextIdx + 1, distanceM, etaMinutes: Math.max(1, Math.ceil(distanceM / 1000 / kmh * 60)) },
    speedKmh: Math.round(kmh),
    speedMeasured: measured,
  };
}

module.exports = { nextStopEta, averageSpeedKmh, metres };
