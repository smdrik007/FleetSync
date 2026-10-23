// Pure helpers for the authority console. No React or Expo imports so node --test can run them.
import { STALE_MS } from './logic.ts'; // explicit extension so node --test can load this file

export const VEHICLE_STATUSES = ['idle', 'on_trip', 'maintenance', 'offline', 'retired'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

/** "on_trip" → "On trip" */
export function statusLabel(s: string): string {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const statusTone = (s: string) => (s === 'on_trip' ? 'green' : s === 'idle' ? 'accent' : s === 'maintenance' ? 'amber' : 'muted') as 'green' | 'accent' | 'amber' | 'muted';

/** ৳ 12,345.5: grouped thousands, at most 2 decimals, "—" when the server has no number. */
export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const [whole, frac] = (Math.round(n * 100) / 100).toString().split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `৳ ${grouped}${frac ? `.${frac}` : ''}`;
}

export function fmtKm(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined ? '—' : `${n.toFixed(digits)} km`;
}

export function fmtLitres(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : `${n.toFixed(1)} L`;
}

/** Count vehicles per status; every known status is present, even with 0. */
export function countByStatus(vehicles: { currentStatus: string }[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, 0]));
  for (const v of vehicles) out[v.currentStatus] = (out[v.currentStatus] ?? 0) + 1;
  return out;
}

export const unreadCount = (items: { isRead: boolean }[]) => items.filter((n) => !n.isRead).length;

// ─── Live positions ───────────────────────────────────────────────────

export type Pos = {
  vehicleId: string;
  vehicleNumber: string;
  lat: number;
  lng: number;
  speed: number | null;
  /** epoch ms of the fix */
  at: number;
};

/** GET /fleet/positions row → Pos */
export function fromPositionRow(r: { vehicleId: string; vehicleNumber: string; lat: number; lng: number; speed: number | null; recordedAt: string }): Pos {
  return { vehicleId: r.vehicleId, vehicleNumber: r.vehicleNumber, lat: r.lat, lng: r.lng, speed: r.speed, at: Date.parse(r.recordedAt) };
}

/** Apply a `location.update` event. Out-of-order (older) fixes are ignored; unknown vehicles are added. */
export function applyLocation(
  map: Record<string, Pos>,
  d: { vehicleId: string; vehicleNumber?: string; latitude: number; longitude: number; speed?: number | null; timestamp?: string },
  now: number = Date.now(),
): Record<string, Pos> {
  const at = d.timestamp ? Date.parse(d.timestamp) : now;
  const prev = map[d.vehicleId];
  if (prev && Number.isFinite(at) && at < prev.at) return map;
  return {
    ...map,
    [d.vehicleId]: {
      vehicleId: d.vehicleId,
      vehicleNumber: d.vehicleNumber ?? prev?.vehicleNumber ?? '',
      lat: d.latitude,
      lng: d.longitude,
      speed: d.speed ?? null,
      at: Number.isFinite(at) ? at : now,
    },
  };
}

export const isStale = (p: Pos, now: number = Date.now()) => now - p.at > STALE_MS;

/** One point feature per vehicle for the map layer; `stale` drives the colour. */
export function positionsToGeoJson(map: Record<string, Pos>, now: number = Date.now()) {
  return {
    type: 'FeatureCollection' as const,
    features: Object.values(map).map((p) => ({
      type: 'Feature' as const,
      properties: { id: p.vehicleId, name: p.vehicleNumber, stale: isStale(p, now) },
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    })),
  };
}

/** Nearest vehicle to a tapped coordinate within `maxMetres`, else null (used for tap-to-select). */
export function nearestPos(map: Record<string, Pos>, lat: number, lng: number, maxMetres = 400): Pos | null {
  let best: Pos | null = null;
  let bestD = maxMetres;
  for (const p of Object.values(map)) {
    const dLat = ((p.lat - lat) * Math.PI) / 180;
    const dLng = ((p.lng - lng) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat * Math.PI) / 180) * Math.cos((p.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    const d = 2 * 6371000 * Math.asin(Math.sqrt(a));
    if (d <= bestD) { best = p; bestD = d; }
  }
  return best;
}

/** Case-insensitive match of a search box against any of the given fields. */
export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  return !q || fields.some((f) => (f ?? '').toLowerCase().includes(q));
}
