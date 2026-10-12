// Background GPS: a foreground-service location task feeds a SQLite queue that is replayed to the API.
// Imported from index.js so TaskManager.defineTask runs at module scope, before any screen mounts.
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { type SQLiteDatabase, openDatabaseSync } from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';
import { AppState, PermissionsAndroid, Platform } from 'react-native';

import { ApiError, SESSION_KEY, api, authState } from './api';
import { type FlushResult, type TripState, flushQueue, reconcile, startWhenForeground, toPoint } from './logic';
import { loadServer } from './server-store';

const TASK = 'fleetsync-gps';
const TRIP_KEY = 'fs_trip';

// ─── Persisted trip state (readable by the headless task) ─────────────

export async function readTrip(): Promise<TripState | null> {
  try {
    const raw = await SecureStore.getItemAsync(TRIP_KEY);
    return raw ? (JSON.parse(raw) as TripState) : null;
  } catch {
    return null;
  }
}
const writeTrip = (trip: TripState) => SecureStore.setItemAsync(TRIP_KEY, JSON.stringify(trip));
const clearTrip = () => SecureStore.deleteItemAsync(TRIP_KEY).catch(() => {});

// ─── Queue ────────────────────────────────────────────────────────────

let database: SQLiteDatabase | null = null;
function db(): SQLiteDatabase {
  if (!database) {
    database = openDatabaseSync('fleetsync.db');
    database.execSync(
      'CREATE TABLE IF NOT EXISTS gps_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id TEXT NOT NULL, body TEXT NOT NULL)',
    );
  }
  return database;
}
export const pendingCount = () => db().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM gps_queue')?.n ?? 0;

// ─── Live status for the UI (same JS runtime as the task while the app is alive) ───

export type Live = {
  queued: number;
  lastFix: { latitude: number; longitude: number; accuracy: number | null; speed: number | null } | null;
};
let live: Live = { queued: 0, lastFix: null };
const listeners = new Set<() => void>();
function setLive(patch: Partial<Live>) {
  live = { ...live, ...patch };
  listeners.forEach((fn) => fn());
}
export const getLive = () => live;
export function subscribeLive(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ─── Flush ────────────────────────────────────────────────────────────

/** The app may be headless (no session provider ran), so the task loads the token itself. */
async function ensureToken() {
  if (authState.token) return;
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (raw) authState.token = (JSON.parse(raw) as { token: string }).token;
  } catch { /* no usable session: the post will 401 */ }
}

let inFlight: Promise<FlushResult> | null = null;
/** One flush at a time; callers that arrive meanwhile share its result. */
export function flush(): Promise<FlushResult> {
  if (!inFlight) {
    inFlight = (async () => {
      await loadServer(); // the headless task may run before any screen did
      await ensureToken();
      return flushQueue({
        peek: async (n) => db().getAllSync('SELECT id, trip_id, body FROM gps_queue ORDER BY id LIMIT ?', n),
        remove: async (ids) => { db().runSync(`DELETE FROM gps_queue WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids); },
        removeTrip: async (tripId) => { db().runSync('DELETE FROM gps_queue WHERE trip_id = ?', tripId); },
        post: async (tripId, body) => { await api.post(`/driver/trips/${tripId}/location`, JSON.parse(body)); },
      });
    })().finally(() => {
      inFlight = null;
      setLive({ queued: pendingCount() });
    });
  }
  return inFlight;
}

// ─── Background task ──────────────────────────────────────────────────

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const trip = await readTrip();
  if (!trip || trip.ending) {
    // FR-DRV-03: no active trip means no tracking, whatever started this task.
    await Location.stopLocationUpdatesAsync(TASK).catch(() => {});
    return;
  }
  for (const fix of data.locations) {
    db().runSync('INSERT INTO gps_queue (trip_id, body) VALUES (?, ?)', trip.tripId, JSON.stringify(toPoint(fix)));
  }
  const { coords } = data.locations[data.locations.length - 1];
  setLive({ queued: pendingCount(), lastFix: { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, speed: coords.speed } });
  await flush();
});

// ─── Controls ─────────────────────────────────────────────────────────

const isRunning = () => Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false);
const stopUpdates = async () => {
  if (await isRunning()) await Location.stopLocationUpdatesAsync(TASK).catch(() => {});
};

/** With the phone's Location switch off the OS delivers nothing, however many permissions the app holds. */
async function ensureServicesOn(): Promise<void> {
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new Error('Location is turned off on this phone. Turn it on in the quick settings, then try again.');
  }
}

/** Foreground, then background ("Allow all the time"), then the notification the service shows on Android 13+. */
export async function ensurePermissions(): Promise<void> {
  await ensureServicesOn();
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) throw new Error('Allow location access to share your trip.');
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted) throw new Error('Choose "Allow all the time" so tracking continues while the screen is off.');
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    // Not fatal: without it the in-app banner still shows, only the status-bar notification is hidden.
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => {});
  }
}

export async function startSharing(tripId: string): Promise<void> {
  await ensurePermissions();
  await writeTrip({ tripId, ending: false });
  await stopUpdates(); // restart cleanly if an older run is still registered
  // distanceInterval 0: a bus waiting at a stop still reports, so passengers don't see "Signal lost" (FR-PAS-04).
  await startWhenForeground(
    () =>
      Location.startLocationUpdatesAsync(TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 0,
        foregroundService: {
          notificationTitle: 'Live Location Sharing is ACTIVE',
          notificationBody: 'FleetSync shares this vehicle’s location until you end the trip.',
          killServiceOnDestroy: false,
        },
      }),
    () => AppState.currentState === 'active',
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  );
  setLive({ queued: pendingCount() });
}

/** Stops tracking now. The saved trip goes first, because the task treats "no trip" as a stop signal. */
export async function stopSharing(): Promise<void> {
  await clearTrip();
  await stopUpdates();
  setLive({ lastFix: null });
}

/**
 * FR-DRV-03 order: stop tracking, upload everything queued (the server rejects points after /end), then end.
 * Throws ApiError when it cannot finish; the trip stays in the "ending" state and can be retried.
 */
export async function endTrip(tripId: string): Promise<void> {
  await writeTrip({ tripId, ending: true });
  await stopUpdates();
  setLive({ lastFix: null });

  let result = await flush();
  // A task callback may have queued one more point while the flush ran.
  for (let i = 0; i < 2 && result === 'drained' && pendingCount() > 0; i++) result = await flush();
  if (result === 'retry') throw new ApiError('Cannot upload your last points yet. Check your connection and try again.', 'NETWORK');
  if (result === 'unauthorized') throw new ApiError('Your session expired. Sign in again.', 'INVALID_TOKEN', 401);

  try {
    await api.post(`/driver/trips/${tripId}/end`);
  } catch (e) {
    const code = e instanceof ApiError ? e.code : undefined;
    if (code !== 'TRIP_NOT_FOUND' && code !== 'TRIP_ALREADY_ENDED') throw e;
  }
  await clearTrip();
  setLive({ queued: pendingCount() });
}

/** Called whenever the server's view of the active trip is known (app start, foreground, after changes). */
export async function syncTracking(activeTripId: string | null): Promise<void> {
  const local = await readTrip();
  switch (reconcile(activeTripId, local, await isRunning())) {
    case 'start':
      // Refreshes also fire from the socket and timers while the app is in the background, where Android
      // refuses to start the service. Wait for the next time the app is on screen.
      if (AppState.currentState === 'active') await startSharing(activeTripId as string);
      break;
    case 'stop':
      await stopSharing();
      await flush().catch(() => {}); // a 403 for the finished trip purges its leftovers
      break;
    default:
      break; // 'none', or 'pending-end' which the screen shows with a retry button
  }
  setLive({ queued: pendingCount() });
  // A trip is running but the phone cannot produce fixes: say so instead of showing a live banner.
  if (activeTripId && !(await readTrip())?.ending) await ensureServicesOn();
}

/** Sign-out and session expiry: nothing may keep tracking or leak points into the next login. */
export async function resetTracking(): Promise<void> {
  await stopSharing();
  try { db().runSync('DELETE FROM gps_queue'); } catch { /* no queue yet */ }
  setLive({ queued: 0, lastFix: null });
}
