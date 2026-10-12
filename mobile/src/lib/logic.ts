// Pure helpers for the driver and passenger screens. No React and no Expo imports, so `node --test` runs this file.

export type Stop = { name: string; latitude: number; longitude: number };

/** FR-PAS-03: "A → B --> C -> D, E" becomes ["A", "B", "C", "D", "E"]. Port of website/app.js parseRoute. */
export function parseRoute(text?: string | null): string[] {
  if (!text || !text.trim()) return [];
  return text.split(/\s*(?:-->|->|→|,)\s*/).map((s) => s.trim()).filter(Boolean);
}

/** Great-circle distance in metres between [lat, lng] pairs. */
export function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Index of the stop nearest the bus (the "current" milestone); -1 before a trip starts. */
export function milestoneIndex(
  stops: Stop[],
  pos: { latitude: number | null; longitude: number | null } | null,
  onTrip: boolean,
): number {
  if (!onTrip || !stops.length || !pos || pos.latitude == null || pos.longitude == null) {
    return onTrip && stops.length ? 0 : -1;
  }
  let best = 0;
  let bestDistance = Infinity;
  stops.forEach((s, i) => {
    const d = haversine([s.latitude, s.longitude], [pos.latitude as number, pos.longitude as number]);
    if (d < bestDistance) { bestDistance = d; best = i; }
  });
  return best;
}

/** Matches the server's LOCATION_STALE_MS default (FR-PAS-04). */
export const STALE_MS = 30_000;

export function timeAgo(then: number, now: number = Date.now()): string {
  const secs = Math.max(0, Math.floor((now - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
}

/** Trip timer: 05:07, or 1:02:09 past the hour. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ─── GPS queue ────────────────────────────────────────────────────────

export type Fix = {
  coords: { latitude: number; longitude: number; accuracy: number | null; speed: number | null; heading: number | null };
  timestamp: number;
};

/** Body for POST /driver/trips/:id/location. The OS reports -1 for "unknown" speed/heading. */
export function toPoint(l: Fix) {
  const known = (v: number | null) => (v == null || v < 0 ? null : v);
  return {
    latitude: l.coords.latitude,
    longitude: l.coords.longitude,
    accuracy: l.coords.accuracy ?? null,
    speed: known(l.coords.speed),
    heading: known(l.coords.heading),
    timestamp: new Date(l.timestamp).toISOString(),
  };
}

export type FlushAction = 'retry' | 'unauthorized' | 'drop' | 'trip-ended';

/** What to do with a queued point after the server's answer. `status` is undefined for network errors. */
export function flushAction(status?: number, code?: string): FlushAction {
  if (status === undefined) return 'retry';
  if (status === 401) return 'unauthorized';
  if (status === 404 || (status === 403 && code === 'TRIP_NOT_ACTIVE')) return 'trip-ended';
  if (status >= 500) return 'retry';
  return 'drop'; // any other 4xx: a point the server will never accept must not block the queue
}

export type Row = { id: number; trip_id: string; body: string };
export type FlushDeps = {
  peek: (limit: number) => Promise<Row[]>;
  remove: (ids: number[]) => Promise<void>;
  removeTrip: (tripId: string) => Promise<void>;
  /** Throws an error carrying `status` and `code` (ApiError) on failure. */
  post: (tripId: string, body: string) => Promise<void>;
};
export type FlushResult = 'drained' | 'retry' | 'unauthorized' | 'trip-ended';

/** Sends queued points oldest-first. Stops at the first point that cannot be delivered, so order is preserved. */
export async function flushQueue(deps: FlushDeps, batch = 50): Promise<FlushResult> {
  for (;;) {
    const rows = await deps.peek(batch);
    if (!rows.length) return 'drained';
    const sent: number[] = [];
    for (const row of rows) {
      try {
        await deps.post(row.trip_id, row.body);
        sent.push(row.id);
      } catch (e) {
        const err = e as { status?: number; code?: string };
        const action = flushAction(err.status, err.code);
        if (sent.length) await deps.remove(sent);
        if (action === 'drop') { await deps.remove([row.id]); sent.length = 0; continue; }
        if (action === 'trip-ended') await deps.removeTrip(row.trip_id);
        return action;
      }
    }
    if (sent.length) await deps.remove(sent);
  }
}

// ─── Starting the location service ────────────────────────────────────

const NOT_ON_SCREEN =
  'Android only lets location sharing start while FleetSync is on screen. Keep the app open and tap Try again.';
const FGS_REFUSED = /foreground service cannot be started|couldn't start the foreground service|ForegroundServiceStartNotAllowed/i;

/**
 * Android starts a location foreground service only while the app is on screen, and right after a permission
 * screen the activity is not resumed yet. Wait for the foreground, and retry a refusal that says exactly that.
 * Any other error (missing permission, no provider) is reported at once.
 */
export async function startWhenForeground(
  start: () => Promise<void>,
  isForeground: () => boolean,
  sleep: (ms: number) => Promise<void>,
  { waitMs = 5000, retries = 3, retryMs = 700 } = {},
): Promise<void> {
  for (let waited = 0; !isForeground(); waited += 200) {
    if (waited >= waitMs) throw new Error(NOT_ON_SCREEN);
    await sleep(200);
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await start();
    } catch (e) {
      if (!FGS_REFUSED.test(String((e as Error)?.message ?? e))) throw e;
      if (attempt >= retries) throw new Error(NOT_ON_SCREEN);
      await sleep(retryMs);
    }
  }
}

// ─── Trip tracking state ──────────────────────────────────────────────

/** Persisted on the phone so the headless GPS task and a restarted app agree on what is running. */
export type TripState = { tripId: string; ending: boolean };
export type Sync = 'start' | 'stop' | 'pending-end' | 'none';

/**
 * Decides what the phone must do given the server's active trip, the locally saved trip and whether
 * location updates are running. FR-DRV-03: tracking exists only while the server says a trip is active.
 */
export function reconcile(activeTripId: string | null, local: TripState | null, running: boolean): Sync {
  if (local?.ending) return activeTripId ? 'pending-end' : 'stop';
  if (activeTripId) return local?.tripId === activeTripId && running ? 'none' : 'start';
  return local || running ? 'stop' : 'none';
}
