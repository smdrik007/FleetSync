# FleetSync — API Contracts

**Phase:** Step 2 — System Architecture & Detailed Design
**Follows from:** `docs/SRS.md` (IEEE 830-1998, v2.0 Final)
**Preceded by:** UI Wireframe (approved ✅)
**Next:** Feature-by-feature Implementation (Step 3)

---

## Conventions

| Convention | Value |
|---|---|
| Base URL (dev) | `http://localhost:3000/api/v1` |
| Base URL (prod) | `https://api.fleetsync.app/api/v1` |
| Auth header | `Authorization: Bearer <jwt>` |
| Content-Type | `application/json` |
| Tenant scoping | Every authenticated request carries `institutionId` extracted from the JWT — **never** passed manually by the client |
| Timestamps | ISO 8601 UTC — e.g. `"2026-09-14T08:42:00Z"` |
| IDs | UUID v4 strings |

### Error Envelope

```json
{
  "success": false,
  "error": {
    "code": "VEHICLE_NOT_FOUND",
    "message": "No vehicle with that ID exists in your institution.",
    "details": {}
  }
}
```

### Success Envelope

```json
{
  "success": true,
  "data": { }
}
```

### Role Legend

| Symbol | Role | JWT `role` value |
|---|---|---|
| 🛡️ | Transportation Pool / Authority | `AUTHORITY` |
| 🚌 | Driver | `DRIVER` |
| 👤 | Passenger | `PASSENGER` |
| 🌐 | Public (no auth required) | — |

---

## Module 1 — Authentication `FR-AUTH-01 → FR-AUTH-04`

### `GET /institutions` 🌐
Fetch the institution list for the login-page dropdown.

**Auth:** None (public)

**Query params:**

| Param | Type | Required | Description |
|---|---|---|---|
| `q` | string | No | Search/filter by institution name |
| `limit` | int | No | Max results (default 50) |

**Response 200:**

```json
{
  "success": true,
  "data": [
    {
      "id": "ku-001",
      "name": "Khulna University",
      "slug": "ku",
      "logoUrl": "https://cdn.fleetsync.app/logos/ku.png"
    },
    {
      "id": "apx-002",
      "name": "Apex Logistics Co.",
      "slug": "apex",
      "logoUrl": null
    }
  ]
}
```

**SRS:** `FR-AUTH-01`

---

### `POST /auth/login` 🌐
Authenticate a user and receive a JWT.

**Auth:** None

**Request body:**

```json
{
  "institutionId": "ku-001",
  "email": "authority@ku.edu.bd",
  "password": "plaintext_password"
}
```

**Response 200:**

```json
{
  "success": true,
  "data": {
    "token": "<jwt>",
    "user": {
      "id": "usr-abc123",
      "name": "Transport Pool",
      "email": "authority@ku.edu.bd",
      "role": "AUTHORITY",
      "institutionId": "ku-001"
    },
    "redirectTo": "/authority/dashboard"
  }
}
```

**JWT payload:**

```json
{
  "sub": "usr-abc123",
  "institutionId": "ku-001",
  "role": "AUTHORITY",
  "iat": 1726300000,
  "exp": 1726386400
}
```

**Errors:**

| HTTP | Code | Reason |
|---|---|---|
| 400 | `MISSING_FIELDS` | `institutionId`, `email`, or `password` absent |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password |
| 403 | `INSTITUTION_MISMATCH` | User does not belong to given institution |
| 404 | `INSTITUTION_NOT_FOUND` | No institution with that ID |

**SRS:** `FR-AUTH-01`, `FR-AUTH-02`, `FR-AUTH-03`

---

### `POST /auth/logout` 🛡️🚌👤
Invalidate the current session.

**Auth:** Any authenticated role

**Request body:** *(none)*

**Response 200:**

```json
{ "success": true, "data": { "message": "Logged out successfully." } }
```

---

### `GET /auth/me` 🛡️🚌👤
Return the currently authenticated user's profile.

**Auth:** Any authenticated role

**Response 200:**

```json
{
  "success": true,
  "data": {
    "id": "usr-abc123",
    "name": "Rahim Uddin",
    "email": "rahim@ku.edu.bd",
    "role": "DRIVER",
    "institutionId": "ku-001",
    "phone": "+8801822987654"
  }
}
```

**SRS:** `FR-AUTH-04`

---

## Module 2 — Fleet / Vehicle Management `FR-POOL-01 → FR-POOL-05`

> All endpoints below are **Authority-only** (`🛡️`).
> All queries are automatically filtered by `institutionId` from the JWT. `FR-AUTH-04`

---

### `GET /fleet/vehicles` 🛡️
List all vehicles belonging to the Authority's institution.

**Auth:** `AUTHORITY`

**Query params:**

| Param | Type | Required | Description |
|---|---|---|---|
| `status` | string | No | Filter by: `ACTIVE`, `ON_TRIP`, `MAINTENANCE`, `INACTIVE` |

**Response 200:**

```json
{
  "success": true,
  "data": [
    {
      "id": "veh-001",
      "vehicleNumber": "Bus #01",
      "plateNumber": "KH-DHA-11-1001",
      "model": "Tata LPO 1512",
      "capacity": 40,
      "currentStatus": "ACTIVE",
      "assignedRoute": "Sonadanga → Shibbari → KU Main Gate → Campus",
      "assignedDriver": {
        "id": "usr-drv-001",
        "name": "Rahim Uddin",
        "phone": "+8801822987654"
      },
      "institutionId": "ku-001",
      "createdAt": "2026-09-01T00:00:00Z",
      "updatedAt": "2026-09-14T06:00:00Z"
    },
    {
      "id": "veh-002",
      "vehicleNumber": "Bus #02",
      "plateNumber": "KH-DHA-11-1002",
      "model": "Tata LPO 1512",
      "capacity": 40,
      "currentStatus": "ON_TRIP",
      "assignedRoute": "Boyra → Khalishpur → Campus",
      "assignedDriver": {
        "id": "usr-drv-002",
        "name": "Karim Hossain",
        "phone": "+8801711234567"
      },
      "institutionId": "ku-001",
      "createdAt": "2026-09-01T00:00:00Z",
      "updatedAt": "2026-09-14T08:42:00Z"
    }
  ]
}
```

**SRS:** `FR-POOL-01`

---

### `POST /fleet/vehicles` 🛡️
Register a new vehicle in the institution's fleet.

**Auth:** `AUTHORITY`

**Request body:**

```json
{
  "vehicleNumber": "Bus #03",
  "plateNumber": "KH-DHA-11-1003",
  "model": "Tata LPO 1512",
  "capacity": 40,
  "currentStatus": "INACTIVE",
  "assignedRoute": "",
  "assignedDriverId": null
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `vehicleNumber` | string | ✅ | Display name, e.g. `"Bus #03"` |
| `plateNumber` | string | ✅ | Must be unique within institution |
| `model` | string | No | Vehicle model |
| `capacity` | int | No | Passenger capacity |
| `currentStatus` | enum | No | Default: `INACTIVE` |
| `assignedRoute` | string | No | Free-text; default `""` |
| `assignedDriverId` | UUID | No | Must belong to same institution |

**Response 201:**

```json
{
  "success": true,
  "data": {
    "id": "veh-003",
    "vehicleNumber": "Bus #03",
    "plateNumber": "KH-DHA-11-1003",
    "model": "Tata LPO 1512",
    "capacity": 40,
    "currentStatus": "INACTIVE",
    "assignedRoute": "",
    "assignedDriver": null,
    "institutionId": "ku-001",
    "createdAt": "2026-09-14T10:00:00Z",
    "updatedAt": "2026-09-14T10:00:00Z"
  }
}
```

**Errors:**

| HTTP | Code | Reason |
|---|---|---|
| 400 | `MISSING_FIELDS` | `vehicleNumber` or `plateNumber` absent |
| 409 | `PLATE_DUPLICATE` | Plate number already exists in institution |
| 404 | `DRIVER_NOT_FOUND` | `assignedDriverId` not found in institution |

**SRS:** `FR-POOL-01`

---

### `GET /fleet/vehicles/:vehicleId` 🛡️
Get a single vehicle's full details.

**Auth:** `AUTHORITY`

**Response 200:** *(same schema as single item in list above)*

**Errors:**

| HTTP | Code | Reason |
|---|---|---|
| 404 | `VEHICLE_NOT_FOUND` | Vehicle doesn't exist or belongs to another institution |

**SRS:** `FR-POOL-01`, `FR-AUTH-04`

---

### `PUT /fleet/vehicles/:vehicleId` 🛡️
Update a vehicle's route, driver assignment, status, or any other field. Every successful mutation triggers a real-time WebSocket broadcast.

**Auth:** `AUTHORITY`

**Request body** *(all fields optional — only include what's changing):*

```json
{
  "assignedRoute": "Sonadanga → Shibbari → KU Main Gate → Campus",
  "assignedDriverId": "usr-drv-001",
  "currentStatus": "ACTIVE",
  "vehicleNumber": "Bus #01",
  "plateNumber": "KH-DHA-11-1001",
  "model": "Tata LPO 1512",
  "capacity": 40
}
```

> **Conflict-prevention rule** (`FR-POOL-03`): If `assignedDriverId` points to a driver currently assigned to **another** vehicle in the same institution, that other vehicle's `assignedDriverId` is automatically set to `null` before this assignment is saved.

**Response 200:**

```json
{
  "success": true,
  "data": {
    "id": "veh-001",
    "vehicleNumber": "Bus #01",
    "plateNumber": "KH-DHA-11-1001",
    "model": "Tata LPO 1512",
    "capacity": 40,
    "currentStatus": "ACTIVE",
    "assignedRoute": "Sonadanga → Shibbari → KU Main Gate → Campus",
    "assignedDriver": {
      "id": "usr-drv-001",
      "name": "Rahim Uddin",
      "phone": "+8801822987654"
    },
    "institutionId": "ku-001",
    "updatedAt": "2026-09-14T09:30:00Z"
  }
}
```

**Errors:**

| HTTP | Code | Reason |
|---|---|---|
| 400 | `INVALID_STATUS` | Status not one of the allowed enum values |
| 404 | `VEHICLE_NOT_FOUND` | Vehicle doesn't exist or cross-tenant |
| 404 | `DRIVER_NOT_FOUND` | `assignedDriverId` not found in institution |
| 409 | `PLATE_DUPLICATE` | Plate number already in use by another vehicle |

**Side-effects (real-time):** Triggers `vehicle.route_updated`, `vehicle.driver_assigned`, and/or `vehicle.status_changed` WebSocket events to all connected clients in the institution. `FR-POOL-05`

**SRS:** `FR-POOL-01`, `FR-POOL-02`, `FR-POOL-03`, `FR-POOL-04`, `FR-POOL-05`

---

### `DELETE /fleet/vehicles/:vehicleId` 🛡️
Decommission (soft-delete) a vehicle from the fleet.

**Auth:** `AUTHORITY`

> Vehicles with `currentStatus = ON_TRIP` cannot be deleted.

**Response 200:**

```json
{ "success": true, "data": { "message": "Vehicle decommissioned." } }
```

**Errors:**

| HTTP | Code | Reason |
|---|---|---|
| 409 | `VEHICLE_ON_TRIP` | Cannot decommission a vehicle currently on a trip |
| 404 | `VEHICLE_NOT_FOUND` | Vehicle not found or cross-tenant |

**SRS:** `FR-POOL-01`

---

### `GET /fleet/drivers` 🛡️
List all drivers in the institution — populates the Driver Assignment Dropdown.

**Auth:** `AUTHORITY`

**Response 200:**

```json
{
  "success": true,
  "data": [
    {
      "id": "usr-drv-001",
      "name": "Rahim Uddin",
      "phone": "+8801822987654",
      "email": "rahim@ku.edu.bd",
      "currentVehicleId": "veh-001",
      "currentVehicleNumber": "Bus #01"
    },
    {
      "id": "usr-drv-002",
      "name": "Karim Hossain",
      "phone": "+8801711234567",
      "email": "karim@ku.edu.bd",
      "currentVehicleId": "veh-002",
      "currentVehicleNumber": "Bus #02"
    }
  ]
}
```

> `currentVehicleId: null` means unassigned. The UI renders: `"⚠️ Karim Hossain (Currently Bus #02)"` for the conflict warning. `FR-POOL-03`

**SRS:** `FR-POOL-03`

---

## Module 3 — Driver Console `FR-DRV-01 → FR-DRV-04`

---

### `GET /driver/me/assignment` 🚌
Return the driver's current vehicle assignment and active trip.

**Auth:** `DRIVER`

**Response 200 — assigned, no trip:**

```json
{
  "success": true,
  "data": {
    "assigned": true,
    "vehicle": {
      "id": "veh-002",
      "vehicleNumber": "Bus #02",
      "plateNumber": "KH-DHA-11-1002",
      "capacity": 40,
      "currentStatus": "ACTIVE",
      "assignedRoute": "Boyra → Khalishpur → Campus"
    },
    "activeTrip": null
  }
}
```

**Response 200 — no assignment:**

```json
{
  "success": true,
  "data": {
    "assigned": false,
    "vehicle": null,
    "activeTrip": null
  }
}
```

**Response 200 — trip in progress:**

```json
{
  "success": true,
  "data": {
    "assigned": true,
    "vehicle": {
      "id": "veh-002",
      "vehicleNumber": "Bus #02",
      "plateNumber": "KH-DHA-11-1002",
      "capacity": 40,
      "currentStatus": "ON_TRIP",
      "assignedRoute": "Boyra → Khalishpur → Campus"
    },
    "activeTrip": {
      "id": "trip-xyz",
      "startedAt": "2026-09-14T08:42:00Z",
      "status": "IN_PROGRESS"
    }
  }
}
```

**SRS:** `FR-DRV-01`

---

### `POST /driver/trips/start` 🚌
Start a new trip. Enables GPS broadcasting.

**Auth:** `DRIVER`

**Request body:** *(none — vehicle derived from driver's assignment)*

**Response 201:**

```json
{
  "success": true,
  "data": {
    "tripId": "trip-xyz",
    "vehicleId": "veh-002",
    "vehicleNumber": "Bus #02",
    "startedAt": "2026-09-14T08:42:00Z",
    "status": "IN_PROGRESS"
  }
}
```

**Errors:**

| HTTP | Code | Reason |
|---|---|---|
| 409 | `NO_VEHICLE_ASSIGNED` | Driver has no vehicle assigned |
| 409 | `TRIP_ALREADY_ACTIVE` | A trip is already in progress for this vehicle |

**Side-effects:** Vehicle `currentStatus` → `ON_TRIP` · Broadcasts `vehicle.status_changed` `FR-POOL-05`

**SRS:** `FR-DRV-02`, `FR-DRV-03`

---

### `POST /driver/trips/:tripId/end` 🚌
End the active trip. Terminates GPS broadcasting immediately.

**Auth:** `DRIVER`

**Request body:** *(none)*

**Response 200:**

```json
{
  "success": true,
  "data": {
    "tripId": "trip-xyz",
    "vehicleId": "veh-002",
    "startedAt": "2026-09-14T08:42:00Z",
    "endedAt": "2026-09-14T09:15:00Z",
    "status": "COMPLETED",
    "durationMinutes": 33
  }
}
```

**Errors:**

| HTTP | Code | Reason |
|---|---|---|
| 404 | `TRIP_NOT_FOUND` | Trip doesn't exist or belongs to another driver |
| 409 | `TRIP_ALREADY_ENDED` | Trip is already `COMPLETED` |

**Side-effects:**
- GPS listener terminated client-side (`navigator.geolocation.clearWatch`)
- Vehicle `currentStatus` → `ACTIVE`
- Broadcasts `vehicle.status_changed` + `trip.ended` events `FR-POOL-05`

**SRS:** `FR-DRV-02`, `FR-DRV-03`

---

### `POST /driver/trips/:tripId/location` 🚌
Submit a GPS coordinate update (telemetry heartbeat). Called by `navigator.geolocation.watchPosition`.

**Auth:** `DRIVER`

**Request body:**

```json
{
  "latitude": 22.8033,
  "longitude": 89.5644,
  "accuracy": 4.2,
  "heading": 270.0,
  "speed": 35.5,
  "timestamp": "2026-09-14T08:55:12Z"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `latitude` | float | ✅ | WGS-84 decimal degrees |
| `longitude` | float | ✅ | WGS-84 decimal degrees |
| `accuracy` | float | No | Metres from `GeolocationCoordinates` |
| `heading` | float | No | Degrees clockwise from North |
| `speed` | float | No | m/s |
| `timestamp` | ISO 8601 | ✅ | Device-side GPS fix timestamp |

**Response 200:**

```json
{ "success": true, "data": { "received": true } }
```

**Errors:**

| HTTP | Code | Reason |
|---|---|---|
| 400 | `INVALID_COORDINATES` | `lat`/`lng` out of valid range |
| 403 | `TRIP_NOT_ACTIVE` | Trip is not `IN_PROGRESS` — blocks off-duty tracking |
| 404 | `TRIP_NOT_FOUND` | Trip doesn't belong to this driver |

**Side-effects:** Broadcasts `location.update` WebSocket event · Updates vehicle's `lastKnownPosition`

**SRS:** `FR-DRV-03`, `FR-PAS-02`, `FR-PAS-04`

---

## Module 4 — Passenger Portal `FR-PAS-01 → FR-PAS-05`

---

### `GET /passenger/vehicles` 👤
List all vehicles for the Passenger Vehicle Dropdown.

**Auth:** `PASSENGER`

**Response 200:**

```json
{
  "success": true,
  "data": [
    {
      "id": "veh-001",
      "vehicleNumber": "Bus #01",
      "plateNumber": "KH-DHA-11-1001",
      "currentStatus": "ACTIVE",
      "assignedRoute": "Sonadanga → Shibbari → KU Main Gate → Campus",
      "assignedDriver": {
        "id": "usr-drv-001",
        "name": "Rahim Uddin",
        "phone": "+8801822987654"
      },
      "selectable": true
    },
    {
      "id": "veh-002",
      "vehicleNumber": "Bus #02",
      "plateNumber": "KH-DHA-11-1002",
      "currentStatus": "ON_TRIP",
      "assignedRoute": "Boyra → Khalishpur → Campus",
      "assignedDriver": {
        "id": "usr-drv-002",
        "name": "Karim Hossain",
        "phone": "+8801711234567"
      },
      "selectable": true
    }
  ]
}
```

> `selectable: false` for `MAINTENANCE` or `INACTIVE` vehicles — UI renders them as disabled in the dropdown. `FR-PAS-01`

**SRS:** `FR-PAS-01`, `FR-PAS-05`

---

### `GET /passenger/vehicles/:vehicleId/status` 👤
Fetch a vehicle's live status snapshot — used on initial load before WebSocket connects.

**Auth:** `PASSENGER`

**Response 200 — on trip, position known:**

```json
{
  "success": true,
  "data": {
    "id": "veh-002",
    "vehicleNumber": "Bus #02",
    "plateNumber": "KH-DHA-11-1002",
    "currentStatus": "ON_TRIP",
    "assignedRoute": "Boyra → Khalishpur → Campus",
    "assignedDriver": {
      "id": "usr-drv-002",
      "name": "Karim Hossain",
      "phone": "+8801711234567"
    },
    "activeTrip": {
      "id": "trip-xyz",
      "startedAt": "2026-09-14T08:42:00Z",
      "status": "IN_PROGRESS"
    },
    "lastKnownPosition": {
      "latitude": 22.8033,
      "longitude": 89.5644,
      "accuracy": 4.2,
      "updatedAt": "2026-09-14T08:55:12Z",
      "isStale": false
    }
  }
}
```

**Response 200 — trip not started:**

```json
{
  "success": true,
  "data": {
    "id": "veh-001",
    "vehicleNumber": "Bus #01",
    "currentStatus": "ACTIVE",
    "assignedRoute": "Sonadanga → Shibbari → KU Main Gate → Campus",
    "assignedDriver": { "name": "Rahim Uddin", "phone": "+8801822987654" },
    "activeTrip": null,
    "lastKnownPosition": null
  }
}
```

> `isStale: true` when last position update was received **> 30 seconds ago** — triggers the amber **"Last Seen" badge** in the UI. `FR-PAS-04`

**Errors:**

| HTTP | Code | Reason |
|---|---|---|
| 404 | `VEHICLE_NOT_FOUND` | Not found or cross-tenant |

**SRS:** `FR-PAS-02`, `FR-PAS-04`, `FR-PAS-05`

---

## Module 5 — Real-Time Events (WebSocket / SSE) `FR-POOL-05`

### Connection

```
wss://api.fleetsync.app/ws?token=<jwt>          ← WebSocket (preferred)
GET /events?token=<jwt>                          ← SSE fallback
```

On connect, server extracts `institutionId` from JWT and joins the client to their institution's private channel. Clients **never** receive another institution's events. `FR-AUTH-04`

---

### Channel Rooms

| Room key | Subscribers | Purpose |
|---|---|---|
| `institution:{institutionId}` | Authority, Passengers | All vehicle/trip events |
| `vehicle:{vehicleId}` | Passengers watching a specific bus | Focused location stream |
| `driver:{driverId}` | The driver themselves | Assignment push updates |

---

### Event: `vehicle.route_updated` `FR-POOL-02`, `FR-POOL-05`

```json
{
  "event": "vehicle.route_updated",
  "data": {
    "vehicleId": "veh-001",
    "vehicleNumber": "Bus #01",
    "assignedRoute": "Sonadanga → Shibbari → KU Main Gate → Campus",
    "updatedAt": "2026-09-14T09:30:00Z",
    "institutionId": "ku-001"
  }
}
```

**Receivers:** Driver assigned to vehicle + passengers watching that vehicle.

---

### Event: `vehicle.driver_assigned` `FR-POOL-03`, `FR-DRV-04`

```json
{
  "event": "vehicle.driver_assigned",
  "data": {
    "vehicleId": "veh-002",
    "vehicleNumber": "Bus #02",
    "previousDriverId": "usr-drv-001",
    "newDriver": {
      "id": "usr-drv-002",
      "name": "Karim Hossain",
      "phone": "+8801711234567"
    },
    "updatedAt": "2026-09-14T07:00:00Z",
    "institutionId": "ku-001"
  }
}
```

**Receivers:** New driver (triggers reassignment banner `FR-DRV-04`), previous driver (clears assignment), passengers watching the vehicle.

---

### Event: `vehicle.status_changed` `FR-POOL-04`, `FR-POOL-05`

```json
{
  "event": "vehicle.status_changed",
  "data": {
    "vehicleId": "veh-002",
    "vehicleNumber": "Bus #02",
    "previousStatus": "ACTIVE",
    "currentStatus": "ON_TRIP",
    "changedAt": "2026-09-14T08:42:00Z",
    "institutionId": "ku-001"
  }
}
```

**Receivers:** All institution clients (`institution:ku-001`).

---

### Event: `location.update` `FR-DRV-03`, `FR-PAS-02`

Emitted by server after validating a `POST /driver/trips/:tripId/location` ping.

```json
{
  "event": "location.update",
  "data": {
    "vehicleId": "veh-002",
    "vehicleNumber": "Bus #02",
    "tripId": "trip-xyz",
    "latitude": 22.8033,
    "longitude": 89.5644,
    "accuracy": 4.2,
    "heading": 270.0,
    "speed": 35.5,
    "timestamp": "2026-09-14T08:55:12Z",
    "institutionId": "ku-001"
  }
}
```

**Receivers:** `vehicle:veh-002` channel (all passengers tracking that bus).

---

### Event: `trip.ended` `FR-DRV-02`, `FR-DRV-03`

```json
{
  "event": "trip.ended",
  "data": {
    "tripId": "trip-xyz",
    "vehicleId": "veh-002",
    "vehicleNumber": "Bus #02",
    "endedAt": "2026-09-14T09:15:00Z",
    "institutionId": "ku-001"
  }
}
```

**Receivers:** All institution clients. Passenger UI removes the live marker.

---

### Signal Fallback Logic — Client-side `FR-PAS-04`

```
if (Date.now() - lastLocationUpdate.timestamp) > 30_000 ms:
  → show amber "⚠ Signal Lost — Last updated X minutes ago" badge
  → map marker stays at last known position, turns amber
  → marker reverts to green LIVE on next location.update event
```

No separate server event is needed — the Passenger UI self-monitors the `location.update` heartbeat interval.

---

## Data Models Reference

### Vehicle

```typescript
interface Vehicle {
  id:               string;         // UUID
  institutionId:    string;         // FK → Institution
  vehicleNumber:    string;         // "Bus #01"
  plateNumber:      string;         // unique within institution
  model:            string | null;
  capacity:         number | null;
  currentStatus:    VehicleStatus;
  assignedRoute:    string;         // free-text, "" if unset
  assignedDriverId: string | null;  // FK → User (DRIVER role)
  createdAt:        string;         // ISO 8601
  updatedAt:        string;
}

type VehicleStatus = 'ACTIVE' | 'ON_TRIP' | 'MAINTENANCE' | 'INACTIVE';
```

### Trip

```typescript
interface Trip {
  id:        string;
  vehicleId: string;      // FK → Vehicle
  driverId:  string;      // FK → User (DRIVER)
  status:    TripStatus;
  startedAt: string;      // ISO 8601
  endedAt:   string | null;
}

type TripStatus = 'IN_PROGRESS' | 'COMPLETED';
```

### User

```typescript
interface User {
  id:            string;
  institutionId: string;
  name:          string;
  email:         string;
  phone:         string | null;
  role:          UserRole;
  passwordHash:  string;  // bcrypt — never exposed in API responses
  createdAt:     string;
}

type UserRole = 'AUTHORITY' | 'DRIVER' | 'PASSENGER';
```

### LocationPing (forwarded via WebSocket — not a primary persisted entity)

```typescript
interface LocationPing {
  tripId:    string;
  vehicleId: string;
  latitude:  number;
  longitude: number;
  accuracy:  number | null;
  heading:   number | null;
  speed:     number | null;
  timestamp: string;
}
```

---

## Endpoint Summary Table

| Method | Path | Auth | SRS Tags |
|---|---|---|---|
| `GET` | `/institutions` | 🌐 | FR-AUTH-01 |
| `POST` | `/auth/login` | 🌐 | FR-AUTH-01, 02, 03 |
| `POST` | `/auth/logout` | 🛡️🚌👤 | — |
| `GET` | `/auth/me` | 🛡️🚌👤 | FR-AUTH-04 |
| `GET` | `/fleet/vehicles` | 🛡️ | FR-POOL-01 |
| `POST` | `/fleet/vehicles` | 🛡️ | FR-POOL-01 |
| `GET` | `/fleet/vehicles/:id` | 🛡️ | FR-POOL-01, FR-AUTH-04 |
| `PUT` | `/fleet/vehicles/:id` | 🛡️ | FR-POOL-01–05 |
| `DELETE` | `/fleet/vehicles/:id` | 🛡️ | FR-POOL-01 |
| `GET` | `/fleet/drivers` | 🛡️ | FR-POOL-03 |
| `GET` | `/driver/me/assignment` | 🚌 | FR-DRV-01 |
| `POST` | `/driver/trips/start` | 🚌 | FR-DRV-02, 03 |
| `POST` | `/driver/trips/:id/end` | 🚌 | FR-DRV-02, 03 |
| `POST` | `/driver/trips/:id/location` | 🚌 | FR-DRV-03, FR-PAS-02, 04 |
| `GET` | `/passenger/vehicles` | 👤 | FR-PAS-01, 05 |
| `GET` | `/passenger/vehicles/:id/status` | 👤 | FR-PAS-02, 04, 05 |
| `WS/SSE` | `/ws` or `/events` | 🛡️🚌👤 | FR-POOL-05 |

---

## WebSocket Events Summary

| Event | Triggered by | Receivers |
|---|---|---|
| `vehicle.route_updated` | `PUT /fleet/vehicles/:id` (route change) | Assigned driver + passengers watching vehicle |
| `vehicle.driver_assigned` | `PUT /fleet/vehicles/:id` (driver change) | Old driver, new driver, passengers watching vehicle |
| `vehicle.status_changed` | `PUT /fleet/vehicles/:id`, trip start/end | All institution clients |
| `location.update` | `POST /driver/trips/:id/location` | Passengers watching that vehicle |
| `trip.ended` | `POST /driver/trips/:id/end` | All institution clients |

---

*End of API Contracts — FleetSync v1.0*
*Ready for Step 3: Feature-by-Feature Implementation*
