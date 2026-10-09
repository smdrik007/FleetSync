# ER-Aligned Web App Redesign — Design Spec

Date: 2026-10-10 · Status: awaiting review

## 1. Goal

Rebuild the FleetSync web app so its structure mirrors the v2.0 ER diagram
(`docs/fleetsync_er_schema.md`, `backend/prisma/schema.prisma`): every ER view
and entity gets a screen backed by a real API. The result must look
professional and feel dynamic (live updates, animated KPIs, charts, filtering).

Success criteria:
- Every tenant-owned entity in the ER diagram can be viewed in the Authority
  console; operational ones can be created/edited/deleted.
- Relationships in the ER diagram are navigable in the UI (a vehicle's drawer
  links to its model, driver, route, devices, trips, maintenance, fuel).
- Live vehicle positions and notifications update without a page reload.
- All data is tenant-scoped by `institution_id` from the JWT; nothing crosses tenants.
- Works at desktop and phone widths; light and dark themes.

Out of scope: auth model changes, enforcing `permissions` codes (the console
shows roles/permissions read-mostly; access is still gated by role name
`AUTHORITY`/`DRIVER`/`PASSENGER`), platform-admin UI (`platform_admins` is
not tenant-scoped), mobile app changes, DB schema changes.

## 2. Architecture

Approach A: single-page Authority console, hash router, vanilla ES modules,
no build step, served by the existing Express static handler.

```
website/
  index.html                 login (restyled)
  style.css                  shared design system (tokens, components)
  app.js                     shared Auth / Api / WsManager (extended, not replaced)
  authority/
    index.html               shell: sidebar, topbar, <main id="view">
    js/
      main.js                boot, auth guard, WS wiring
      router.js              hash router: #/fleet/vehicles, #/vehicles/:id ...
      ui.js                  table, drawer, modal, form, badge, toast, skeleton, chart helpers
      views/
        dashboard.js
        vehicles.js  models.js  drivers.js  routes.js  stops.js
        livemap.js   trips.js   devices.js
        maintenance.js  fuel.js  notifications.js
        users.js  roles.js  subscription.js  institution.js
  driver/index.html         restyled, same flow
  passenger/index.html      restyled, same flow
```

Each view module exports `{ title, render(ctx) , destroy() }`. `ctx` holds route
params and shared helpers. `destroy()` unsubscribes WS handlers and timers.
The existing `authority/fleet-map.html` is folded into `views/livemap.js`.

Libraries (CDN, pinned): Leaflet 1.9.4 (already used), Chart.js 4.4.x.

## 3. Information architecture

| Nav group | Screen | ER tables |
|---|---|---|
| Overview | Dashboard | cross-view aggregates |
| Fleet | Vehicles | `vehicles` (+ model, driver, route joins) |
| Fleet | Vehicle Models | `vehicle_models` (global catalog rows read-only) |
| Fleet | Drivers | `drivers` (+ linked `users`) |
| Fleet | Routes | `routes`, `route_stops` (ordered stop editor) |
| Fleet | Stops | `stops` |
| Tracking | Live Map | `vehicle_latest_position` |
| Tracking | Trips | `trips`, `gps_logs` (replay) |
| Tracking | Devices | `devices` |
| Operations | Maintenance | `maintenance_records` |
| Operations | Fuel Logs | `fuel_logs` |
| Operations | Notifications | `notifications` |
| Administration | Users | `users`, `user_roles` |
| Administration | Roles & Permissions | `roles`, `permissions`, `role_permissions` |
| Administration | Subscription | `subscriptions` |
| Administration | Institution | `institutions` |

Screen pattern: header with count + primary action; filter bar (search,
status chips); table with sort and pagination; row click opens a detail
drawer showing the entity's relationships as linked sections. Create/edit
use a modal form; optional FKs (`assigned_driver_id`, `assigned_route_id`,
`trips.route_id`) are explicit "None" choices.

Driver and passenger apps keep their flows and get the shared visual system.
Driver app additionally surfaces its notifications.

## 4. Backend API

All routes live under `/api/v1`, are authenticated, and derive the tenant from
`req.user.institutionId`. Responses use the existing envelope
`{ success, data }` / `{ success:false, error:{code,message} }`.
Authority-only unless noted. New code goes in new router files mounted in
`backend/src/index.js`; existing vehicle/driver/passenger endpoints are unchanged.

| Router file | Endpoints (under `/fleet` unless noted) |
|---|---|
| `routes/catalog.js` | `GET/POST /models`, `PUT/DELETE /models/:id` (tenant rows only; global rows listed read-only) |
| `routes/network.js` | `GET/POST /routes`, `GET/PUT/DELETE /routes/:id`, `PUT /routes/:id/stops` (replace ordered list); `GET/POST /stops`, `PUT/DELETE /stops/:id` |
| `routes/tracking.js` | `GET /trips` (filters: status, vehicleId, driverId, from, to), `GET /trips/:id`, `GET /trips/:id/track` (GPS points via PostGIS raw SQL); `GET/POST /devices`, `PUT/DELETE /devices/:id`; `GET /positions` (all `vehicle_latest_position` for the tenant) |
| `routes/operations.js` | `GET/POST /maintenance`, `PUT/DELETE /maintenance/:id`; `GET/POST /fuel`, `DELETE /fuel/:id` (`logged_by_user_id` = caller); `GET /notifications` (any role: own only), `POST /notifications/:id/read`, `POST /notifications/read-all`, `POST /notifications` (authority sends to a user) |
| `routes/admin.js` | `GET /users`, `POST /users`, `PUT /users/:id`, `PUT /users/:id/roles`; `GET /roles`, `GET /permissions`, `GET /roles/:id/permissions`; `GET /subscription`; `GET/PUT /institution` |
| `routes/dashboard.js` | `GET /dashboard/summary` — vehicle counts by status, active trips, devices online/offline, upcoming maintenance, 30-day fuel cost, 14-day trips/day, license expiries within 30 days |

Rules:
- Writes validate enum fields against the schema `CHECK` lists (vehicle,
  device, trip, maintenance, employment, subscription statuses).
- Cross-entity references (driver, route, vehicle, device) are looked up with
  the tenant filter before use; mismatch returns 404/422, never leaks other tenants.
- Deleting a vehicle/driver that has dependent trips returns 409 with a clear message.
- `POST /users` hashes passwords with bcryptjs (as `/auth` does); `password_hash`
  is never returned.
- New writes that change vehicle state emit existing WS events; creating a
  notification emits `notification.new` to that user's socket.

WebSocket additions (reuse `ws/server.js` rooms): `notification.new`,
and `trip.started` / `trip.ended` broadcast to `institution:{id}` so the
dashboard and live map update.

## 5. Design system and UX

- Evolve existing tokens in `style.css`; add a light theme via
  `[data-theme="light"]`, remembered in `localStorage`, defaulting to system preference.
- Components: sidebar (collapsible, grouped by section above), topbar with
  breadcrumbs, command-palette search (`Ctrl+K`, jumps to screens and
  searches vehicles/drivers/routes), notification bell with unread badge,
  KPI cards, status badges (one colour per enum value), tables, drawers,
  modals, skeleton loaders, empty states, toasts.
- Motion: KPI count-up, row/drawer transitions, pulsing live markers;
  all disabled under `prefers-reduced-motion`.
- Charts (Chart.js): trips per day, fuel cost per week, maintenance cost by
  month, fleet status mix (doughnut). Colours come from tokens.
- Accessibility: keyboard-navigable nav, drawers and modals trap focus and
  close on Esc, badge colour never the only signal, AA contrast in both themes.

## 6. Dynamic behaviour

- Live map: markers from `GET /positions`, moved by existing WS location
  events; stale (>5 min) markers dimmed, matching the current `isStale` rule.
  Clicking a marker opens the vehicle drawer.
- Trip replay: `GET /trips/:id/track` drawn as a polyline with a time slider
  and play/pause.
- Dashboard: KPIs refresh on WS events and every 60 s as a fallback.
- Notifications: bell updates on `notification.new`; list view supports
  mark-read / mark-all-read.
- Connection indicator in the topbar (connected / reconnecting).

## 7. Error handling

- `Api` surfaces `err.code`/`err.message`; views show inline error state with
  retry, forms show field-level messages for 422, toasts for others.
- 401 clears auth and returns to login; 403 shows an access-denied state.
- WS drops use the existing exponential backoff; UI shows reconnecting.
- API base URL is derived from `location` when served by Express (falls back
  to `localhost:3000` for file/dev use).

## 8. Testing and verification

- Backend: a smoke script `backend/scripts/smoke-endpoints.js` (Node, uses the
  seeded DB and a real login) exercising each new endpoint: tenant isolation
  (second institution cannot read/modify), enum validation, 409/404 paths.
- Frontend: run the app and click through every screen in the browser pane at
  desktop and 375 px width in both themes; confirm no console errors; verify
  live updates by posting a location through the driver endpoint.
- Seed data is extended (`seed.js`) with routes+stops, devices, trips,
  GPS points, maintenance, fuel logs, notifications so every screen has content.

## 9. Delivery order

1. Backend endpoints + seed extension + smoke script
2. Design system, shell, router, shared UI components
3. Fleet screens → Tracking screens → Operations screens → Administration screens
4. Dashboard and command palette
5. Login, driver, passenger restyle
6. Verification pass (browser, both themes, mobile width)

## 10. Assumptions to confirm

- Role names `AUTHORITY`/`DRIVER`/`PASSENGER` remain the access gate; the
  `permissions` tables are displayed, not enforced.
- Extending `seed.js` with demo data is acceptable (it already seeds two tenants).
- Chart.js from a CDN is acceptable (the site already loads Leaflet from unpkg).
