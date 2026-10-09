'use strict';

/**
 * FleetSync — Real-Time WebSocket Engine
 *
 * Architecture:
 *   - Each authenticated WS client is placed into institution-scoped rooms.
 *   - Drivers also join their personal driver room.
 *   - Passengers who select a vehicle join that vehicle's room.
 *   - Authority/Passengers join the institution-wide room.
 *
 * Rooms (Set<WebSocket>):
 *   institution:{institutionId}
 *   vehicle:{vehicleId}
 *   driver:{driverId}
 */

const WebSocket = require('ws');
const { verifyToken } = require('../middleware/auth');
const prisma = require('../db/client');
const { isUuid } = require('../lib/http');

/** @type {Map<string, Set<WebSocket>>} */
const rooms = new Map();

function getRoomKey(type, id) {
  return `${type}:${id}`;
}

function joinRoom(key, ws) {
  if (!rooms.has(key)) rooms.set(key, new Set());
  rooms.get(key).add(ws);
}

function leaveRoom(key, ws) {
  rooms.get(key)?.delete(ws);
}

/**
 * Broadcast a payload to all live clients in a room.
 * @param {string}   roomKey
 * @param {object}   payload  - { event, data }
 * @param {WebSocket} [skip]  - optional sender to exclude
 */
function broadcast(roomKey, payload, skip = null) {
  const room = rooms.get(roomKey);
  if (!room) return;
  const json = JSON.stringify(payload);
  room.forEach((client) => {
    if (client !== skip && client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  });
}

/**
 * Emit a vehicle event to all relevant rooms.
 *
 * @param {string} event     - event name e.g. 'vehicle.route_updated'
 * @param {object} data      - event payload
 * @param {string} vehicleId - to notify vehicle-room subscribers
 * @param {string} driverId  - to notify the assigned driver (optional)
 * @param {string} institutionId
 */
function emitVehicleEvent({ event, data, vehicleId, driverId, institutionId }) {
  const payload = { event, data };

  // All institution clients (Authority + Passengers on dashboard)
  broadcast(getRoomKey('institution', institutionId), payload);

  // Passengers watching this specific vehicle
  broadcast(getRoomKey('vehicle', vehicleId), payload);

  // The assigned driver (if any)
  if (driverId) broadcast(getRoomKey('driver', driverId), payload);
}

/**
 * Emit a location update only to the vehicle room (not all institution clients
 * to avoid flooding unrelated passenger screens).
 */
function emitLocationUpdate({ data, vehicleId, previousDriverId, institutionId }) {
  const payload = { event: 'location.update', data };
  broadcast(getRoomKey('vehicle', vehicleId), payload);
  // Also notify authority so they can see the bus is alive
  broadcast(getRoomKey('institution', institutionId), payload);
  if (previousDriverId) broadcast(getRoomKey('driver', previousDriverId), payload);
}

/**
 * Push an event to every live socket of one user (any role) — e.g. 'notification.new'.
 */
function emitToUser(userId, event, data) {
  broadcast(getRoomKey('user', userId), { event, data });
}

/**
 * Initialize the WebSocket server attached to the existing HTTP server.
 * @param {import('http').Server} httpServer
 */
function initWebSocket(httpServer) {
  const wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // ── Authenticate via ?token= query param ──────────────────────────
    const url   = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      ws.send(JSON.stringify({ event: 'error', data: { code: 'INVALID_TOKEN', message: 'Token is invalid or expired.' } }));
      ws.close(1008, 'Unauthorized');
      return;
    }

    ws._user = decoded; // { sub, institutionId, role }
    const { sub: userId, institutionId, role } = decoded;

    // ── Join institution room ────────────────────────────────────────
    const instRoom = getRoomKey('institution', institutionId);
    joinRoom(instRoom, ws);

    // ── Join personal user room (notifications) ───────────────────────
    const userRoom = getRoomKey('user', userId);
    joinRoom(userRoom, ws);

    // ── Join personal driver room ────────────────────────────────────
    if (role === 'DRIVER') {
      joinRoom(getRoomKey('driver', userId), ws);
    }

    ws.send(JSON.stringify({ event: 'connected', data: { userId, institutionId, role } }));

    // ── Handle client messages ───────────────────────────────────────
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      // Passengers subscribe to a specific vehicle room
      if (msg.action === 'watch_vehicle' && msg.vehicleId) {
        // Only vehicles of the caller's own institution may be watched.
        const reject = () => ws.send(JSON.stringify({ event: 'error', data: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found.' } }));
        if (!isUuid(msg.vehicleId)) { reject(); return; }
        prisma.vehicle.findFirst({ where: { id: msg.vehicleId, institutionId }, select: { id: true } })
          .then((v) => {
            if (!v) { reject(); return; }
            if (ws.readyState !== WebSocket.OPEN) return;
            const key = getRoomKey('vehicle', v.id);
            joinRoom(key, ws);
            if (!ws._vehicleRooms) ws._vehicleRooms = new Set();
            ws._vehicleRooms.add(key);
            ws.send(JSON.stringify({ event: 'watching', data: { vehicleId: v.id } }));
          })
          .catch((err) => console.error('[WS watch_vehicle]', err.message));
      }

      if (msg.action === 'unwatch_vehicle' && msg.vehicleId) {
        leaveRoom(getRoomKey('vehicle', msg.vehicleId), ws);
      }
    });

    // ── Cleanup on disconnect ────────────────────────────────────────
    ws.on('close', () => {
      leaveRoom(instRoom, ws);
      leaveRoom(userRoom, ws);
      if (role === 'DRIVER') leaveRoom(getRoomKey('driver', userId), ws);
      ws._vehicleRooms?.forEach((k) => leaveRoom(k, ws));
    });

    ws.on('error', (err) => console.error('[WS Error]', err.message));
  });

  console.log('⚡ WebSocket engine initialized');
  return wss;
}

module.exports = { initWebSocket, emitVehicleEvent, emitLocationUpdate, emitToUser, getRoomKey, broadcast };
