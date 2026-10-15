import { api, authState, server } from './api.ts'; // explicit extension so node --test can load this file

/** Read on every connect, so a server address changed in the app applies to the next reconnect. */
const wsUrl = () => `${server.origin.replace(/^http/, 'ws')}/ws`;

export type Socket = { send: (payload: object) => void; close: () => void };
export type Role = 'driver' | 'passenger';

/** After this many sockets in a row that never opened, the server has no WebSocket (serverless): poll instead. */
const MAX_FAILURES = 2;
const POLL_MS = { passenger: 5000, driver: 10000 };

type Seen = { fixAt?: string; tripId?: string | null; routeKey?: string | null; driverKey?: string | null; first: boolean };

/**
 * Port of website/app.js WsManager: Bearer token in the query string, reconnect with backoff 1s → 15s.
 * When the WebSocket never opens, REST snapshots are diffed into the same events (see website/app.js `_poll`),
 * so screens keep their `(event, data)` handlers and the connection indicator stays green.
 */
export function openSocket(
  onEvent: (event: string, data: any) => void,
  onStatus: (connected: boolean) => void,
  role: Role = 'passenger',
): Socket {
  let ws: WebSocket | null = null;
  let delay = 1000;
  let closed = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let watched: string | null = null;
  let seen: Seen = { first: true };

  const pollOnce = async () => {
    if (closed || !authState.token) return;
    try {
      if (role === 'passenger') {
        if (watched) {
          const id = watched;
          const s = await api.get<any>(`/passenger/vehicles/${id}/status`);
          if (closed || watched !== id) return; // another vehicle was picked meanwhile
          const fix = s.lastKnownPosition;
          const tripId: string | null = s.activeTrip?.id ?? null;
          const routeKey: string | null = s.assignedRoute ?? null;
          const driverKey: string | null = s.assignedDriver?.name ?? null;
          if (!seen.first) {
            if (tripId !== seen.tripId) onEvent(tripId ? 'trip.started' : 'trip.ended', { vehicleId: id });
            if (routeKey !== seen.routeKey) onEvent('vehicle.route_updated', { vehicleId: id });
            if (driverKey !== seen.driverKey) onEvent('vehicle.driver_assigned', { vehicleId: id });
            if (fix && fix.updatedAt !== seen.fixAt && fix.latitude != null && fix.longitude != null) {
              onEvent('location.update', { vehicleId: id, latitude: fix.latitude, longitude: fix.longitude });
            }
          }
          seen = { fixAt: fix?.updatedAt, tripId, routeKey, driverKey, first: false };
        }
      } else {
        const a = await api.get<any>('/driver/me/assignment');
        const me = a.driverId as string | undefined;
        const v = a.vehicle;
        const routeKey: string | null = v?.assignedRoute ?? null;
        const driverKey: string | null = v ? 'mine' : null;
        if (!seen.first && me) {
          if (driverKey !== seen.driverKey) {
            onEvent('vehicle.driver_assigned', v ? { newDriver: { id: me } } : { previousDriverId: me });
          }
          if (v && routeKey !== seen.routeKey) onEvent('vehicle.route_updated', { vehicleId: v.id });
        }
        seen = { routeKey, driverKey, first: false };
      }
      onStatus(true);
    } catch {
      onStatus(false);
    }
  };

  const startPolling = () => {
    if (pollTimer || closed) return;
    pollTimer = setInterval(pollOnce, POLL_MS[role]);
    pollOnce();
  };

  const connect = () => {
    if (closed || !authState.token) return;
    let opened = false;
    ws = new WebSocket(`${wsUrl()}?token=${authState.token}`);
    ws.onopen = () => {
      opened = true;
      failures = 0;
      delay = 1000;
      onStatus(true);
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(String(e.data));
        onEvent(msg.event, msg.data);
      } catch { /* ignore malformed frames */ }
    };
    ws.onclose = () => {
      ws = null;
      onStatus(false);
      if (closed) return;
      if (!opened && ++failures >= MAX_FAILURES) {
        startPolling();
        return;
      }
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 15000);
    };
  };
  connect();

  return {
    send: (payload) => {
      const p = payload as { action?: string; vehicleId?: string };
      if (p.action === 'watch_vehicle' && p.vehicleId && p.vehicleId !== watched) {
        watched = p.vehicleId;
        seen = { first: true };
        if (pollTimer) pollOnce();
      } else if (p.action === 'unwatch_vehicle' && p.vehicleId === watched) {
        watched = null;
      }
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    },
    close: () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(pollTimer);
      ws?.close();
    },
  };
}
