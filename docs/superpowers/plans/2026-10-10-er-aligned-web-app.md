# ER-Aligned Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the FleetSync Authority console (and restyle login/driver/passenger) so every ER entity has a screen backed by a tenant-scoped API.

**Architecture:** New Express routers under `/api/v1/fleet/*` (one file per domain) feed a single-page vanilla-ES-module console (`website/authority/`) with a hash router, shared UI components and one view module per screen. Live data rides the existing WebSocket rooms.

**Tech Stack:** Node/Express, Prisma 5 + PostGIS (raw SQL for geography), `ws`, `node:test` + `fetch` for API smoke tests, vanilla JS ES modules, Leaflet 1.9.4, Chart.js 4.4.x (CDN, pinned).

**Spec:** `docs/superpowers/specs/2026-10-10-er-aligned-web-app-design.md`

## Global Constraints

- No frontend build step; `website/` is served statically by Express. `website/app.js` stays a classic script exposing globals `Auth`, `Api`, `WsManager`, `Toast`; ES modules use those globals.
- Tenant is always `req.user.institutionId` (JWT). Never accept `institutionId` from a request body/query. Every cross-entity id from a request is looked up with the tenant filter before use.
- Response envelope: `{ success:true, data }` / `{ success:false, error:{ code, message } }` (existing). Field names camelCase as in Prisma. Never return `passwordHash`.
- Enum values (from schema CHECK lists): vehicle `idle|on_trip|maintenance|offline|retired`; device `active|inactive|faulty|retired`; trip `scheduled|in_progress|completed|cancelled`; maintenance `scheduled|in_progress|completed|cancelled`; employment `active|on_leave|suspended|terminated`; subscription `trial|active|past_due|cancelled|expired`. Invalid value → 422 `INVALID_<FIELD>`.
- Role names `AUTHORITY`/`DRIVER`/`PASSENGER` remain the only access gate; `permissions` tables are displayed, not enforced.
- Stale position rule: older than 5 minutes (matches existing `isStale`).
- Existing vehicle/driver(list,create)/passenger/driver-app endpoints keep their contracts.
- List endpoints return full tenant arrays; tables paginate client-side (`pageSize` 15).
- Motion honors `prefers-reduced-motion`. Layout works at 375 px width. Light and dark themes.
- Git: working tree has unrelated uncommitted changes. Stage only the files named in a task, by explicit path. Run commit steps only if the user has okayed committing in this session.
- Backend commands run from `backend/`. Smoke tests need the API running (`npm run dev`) against the seeded DB (`npm run db:seed`), Node ≥ 18.

## Review Focus

1. A body/query id that belongs to another tenant (driver, route, stop, vehicle, device, role) → 404/422, never accepted. Pinned in Tasks 3, 4, 6.
2. A tenant with zero vehicles/trips/points: existing `GET /fleet/vehicles` builds `IN ()` from an empty array and 500s. Empty lists must return `[]`. Pinned in Task 4.
3. Deleting an entity that still has dependents (vehicle model with vehicles, stop in a route, driver with trips) → 409 with a readable message, not a 500. Pinned in Tasks 1, 2, 3, 6.
4. Route stop reordering with duplicate ids, unknown ids or an empty list → 422; order is 1-based and contiguous. Pinned in Task 3.
5. Reading/marking another user's notification, or a trip with zero GPS points (replay), must be a clean 404 / empty array and the UI must show an empty state. Pinned in Tasks 5, 4, 11.

---

## File Structure

Backend (create unless noted):
- `src/middleware/error.js` (modify): map Prisma `P2002`/`P2003` to 409.
- `src/lib/http.js`: `bad(code,msg,status)` error factory, `assertEnum(value, allowed, field)`, `wrap(fn)` async handler.
- `src/routes/{catalog,network,tracking,operations,admin,dashboard}.js`
- `src/db/seed-demo.js` (called from `seed.js`), `src/ws/server.js` (modify), `src/index.js` (modify), `src/routes/fleet.js` (modify: empty-array guard).
- `scripts/smoke/{helpers,catalog,network,tracking,operations,admin,dashboard}.test.js`

Frontend:
- `website/style.css` (rework), `website/app.js` (extend), `website/index.html`, `website/driver/index.html`, `website/passenger/index.html` (restyle)
- `website/authority/index.html` (shell, replace), `website/authority/js/{main,router,ui}.js`, `website/authority/js/views/*.js` (16 views), delete `website/authority/fleet-map.html`.

---

### Task 1: Test harness, shared backend helpers, demo seed

**Files:**
- Create: `backend/scripts/smoke/helpers.js`, `backend/src/lib/http.js`, `backend/src/db/seed-demo.js`
- Modify: `backend/src/middleware/error.js`, `backend/src/db/seed.js`, `backend/package.json` (script `"smoke": "node --test scripts/smoke"`)

**Interfaces:**
- Produces (`helpers.js`): `login(email: string): Promise<{ token: string, user: object, institutionId: string }>` (password `demo1234`, institution inferred: `@ku.edu.bd` → `00000000-0000-4000-a000-000000000001`, `@apex.com` → `…0002`); `api(token, method, path, body?): Promise<{ status:number, body:any }>` (base `http://localhost:3000/api/v1`, no throwing).
- Produces (`http.js`): `bad(status:number, code:string, message:string): Error`, `assertEnum(value, allowed:string[], field:string): void` (throws 422 `INVALID_<FIELD>`), `wrap(fn): RequestHandler`.
- Produces (seed): per tenant — ≥6 stops and 2 routes with `route_stops`, 1 device per vehicle (varied statuses, `lastSeenAt` mix of recent/old), ≥4 completed trips over the last 14 days plus 1 in_progress, ≥20 `gps_logs` points per completed trip (raw SQL `ST_SetSRID(ST_MakePoint(lng,lat),4326)::geography`), `vehicle_latest_position` for the in-progress trip, ≥5 maintenance records, ≥8 fuel logs spread over 8 weeks, ≥3 notifications per user, permission codes (`vehicles.read`, `vehicles.manage`, `trips.read`, `trips.manage`, `drivers.manage`, `reports.read`) with `role_permissions` for AUTHORITY (all) / DRIVER / PASSENGER (read subsets), one `subscriptions` row (`plan_name` "Professional", `active`), a driver with `licenseExpiry` 10 days out. Idempotent (upserts / fixed ids / skip-if-exists).

- [ ] **Step 1: Write failing test** `scripts/smoke/helpers.test.js`: `login('authority@ku.edu.bd')` returns a token; `api(token,'GET','/auth/me')` status 200 with `data.email`; unauthenticated `api(null,'GET','/fleet/vehicles')` status 401.
- [ ] **Step 2:** Run `npm run smoke` — Expect FAIL (`helpers` missing / script missing).
- [ ] **Step 3:** Implement `helpers.js`, `http.js`, add `smoke` script. In `error.js`, map `err.code==='P2003'` → 409 `HAS_DEPENDENTS` "This record is still referenced by other records." and `P2002` → 409 `DUPLICATE` "A record with these values already exists."
- [ ] **Step 4:** Implement `seed-demo.js` exporting `seedDemo(prisma, { ku, apex, roles, vehicles, drivers, users })`; call it at the end of `main()` in `seed.js`. Use the existing fixed-id style (`00000000-0000-4000-<letter>000-…`).
- [ ] **Step 5:** Run `npm run db:seed` twice (idempotent) then `npm run smoke` — Expect PASS, no duplicate-key errors on the second seed.
- [ ] **Step 6: Commit** `scripts/smoke/ src/lib/http.js src/db/seed-demo.js src/db/seed.js src/middleware/error.js package.json` — "feat(api): smoke harness, error mapping, demo seed".

### Task 2: Vehicle models API

**Files:** Create `backend/src/routes/catalog.js`, `backend/scripts/smoke/catalog.test.js`; Modify `backend/src/index.js` (mount at `/api/v1/fleet`).

**Interfaces:**
- Produces: `GET /fleet/models` → `[{ id, institutionId: string|null, make, model, year, fuelType, capacity, isGlobal: boolean, vehicleCount: number }]` (tenant rows + global rows); `POST /fleet/models` body `{ make, model, year?, fuelType?, capacity? }` → 201 row; `PUT /fleet/models/:id` (same fields, partial); `DELETE /fleet/models/:id`.
- Rules: global rows (`institutionId` null) → PUT/DELETE 403 `GLOBAL_MODEL_READONLY`; DELETE with vehicles → 409; other tenant's row → 404; `make`,`model` required (422 `MISSING_FIELDS`); `capacity` positive int.

- [ ] **Step 1: Write failing tests** (`catalog.test.js`): list contains a global model with `isGlobal:true`; create→update→delete round-trip as KU authority; apex authority `PUT` on the KU-created id → 404; `DELETE` a global id → 403; delete a model used by a seeded vehicle → 409; `POST` without `make` → 422.
- [ ] **Step 2:** Run `npm run smoke -- --test-name-pattern=models` — Expect FAIL (404 route).
- [ ] **Step 3:** Implement `catalog.js` with `AUTH = authenticate('AUTHORITY')`; list `where: { OR:[{institutionId}, {institutionId:null}] }`, count vehicles via `_count`.
- [ ] **Step 4:** Run the same command — Expect PASS.
- [ ] **Step 5: Commit** the three files above — "feat(api): vehicle models endpoints".

### Task 3: Routes and stops API

**Files:** Create `backend/src/routes/network.js`, `backend/scripts/smoke/network.test.js`; Modify `backend/src/index.js`.

**Interfaces:**
- Produces: `GET /fleet/routes` → `[{ id, name, description, stopCount, vehicleCount, createdAt }]`; `GET /fleet/routes/:id` → above plus `stops:[{ stopId, name, latitude, longitude, stopOrder }]` (ordered) and `vehicles:[{ id, vehicleNumber }]`; `POST /fleet/routes` `{ name, description? }`; `PUT /fleet/routes/:id`; `DELETE /fleet/routes/:id` (unassigns vehicles via existing SetNull); `PUT /fleet/routes/:id/stops` body `{ stopIds: string[] }` → full route detail; `GET/POST /fleet/stops` `{ name, latitude, longitude }`; `PUT/DELETE /fleet/stops/:id`.
- Rules: duplicate route name in tenant → 409; `stopIds` empty/duplicates/unknown or foreign-tenant ids → 422 `INVALID_STOPS`; reorder replaces `route_stops` in one transaction (delete then create, `stop_order` 1..n); lat in [-90,90], lng in [-180,180] else 422; deleting a stop used by any route → 409.

- [ ] **Step 1: Write failing tests:** create route + 3 stops, `PUT …/stops` with `[s3,s1,s2]` → detail `stops` ordered `[s3,s1,s2]` with `stopOrder` `[1,2,3]`; re-PUT with `[s2]` → one stop; `stopIds:[]`, `[s1,s1]`, a made-up uuid, and a stop id from the apex tenant each → 422; delete a stop in a route → 409; duplicate route name → 409; latitude 91 → 422; apex token `GET /fleet/routes/:kuRouteId` → 404.
- [ ] **Step 2:** Run `npm run smoke -- --test-name-pattern=network` — Expect FAIL.
- [ ] **Step 3:** Implement `network.js`; validate stop ownership with one `findMany({ where:{ id:{in}, institutionId } })` and compare counts.
- [ ] **Step 4:** Run — Expect PASS.
- [ ] **Step 5: Commit** — "feat(api): routes and stops endpoints".

### Task 4: Tracking API (trips, track, devices, positions) + vehicles empty-list fix

**Files:** Create `backend/src/routes/tracking.js`, `backend/scripts/smoke/tracking.test.js`; Modify `backend/src/index.js`, `backend/src/routes/fleet.js` (guard empty `vehicleIds` before the `$queryRaw`).

**Interfaces:**
- Produces: `GET /fleet/trips?status&vehicleId&driverId&from&to` → `[{ id, status, startedAt, endedAt, vehicle:{id,vehicleNumber}, driver:{id,name}, route:{id,name}|null }]` newest first; `GET /fleet/trips/:id` → same + `pointCount`, `durationMinutes|null`; `GET /fleet/trips/:id/track` → `[{ lat, lng, speed, heading, recordedAt }]` ascending, at most 2000 points (even downsample); `GET /fleet/devices` → `[{ id, vehicle:{id,vehicleNumber}, deviceType, imei, simIccid, firmwareVersion, status, installedAt, lastSeenAt, isOnline }]` (`isOnline` = seen < 5 min); `POST /fleet/devices` `{ vehicleId, deviceType, imei, simIccid?, firmwareVersion?, status? }`; `PUT/DELETE /fleet/devices/:id`; `GET /fleet/positions` → `[{ vehicleId, vehicleNumber, status, lat, lng, speed, heading, ignitionOn, recordedAt, tripId, isStale }]`.
- Rules: foreign `vehicleId`/`driverId` filters → empty list, not an error; device `vehicleId` of another tenant → 422 `INVALID_VEHICLE`; duplicate `imei` → 409; invalid status → 422; trips with no GPS points → `track` returns `[]` with 200.

- [ ] **Step 1: Write failing tests:** trips list returns ≥5 with the in_progress one first and `status` filter works; trip detail `pointCount ≥ 20` for a completed seeded trip and `track` is ordered with numeric `lat`/`lng`; `track` for a trip with no points → `[]`; apex token reading a KU trip → 404; device create with apex vehicle id → 422, duplicate imei → 409, status `broken` → 422; `positions` includes the seeded live vehicle with `isStale:false`; **empty tenant:** create a throwaway institution+authority via Prisma in the test (or use a seeded third empty tenant) and assert `GET /fleet/vehicles` and `GET /fleet/positions` return `[]` with 200.
- [ ] **Step 2:** Run `npm run smoke -- --test-name-pattern=tracking` — Expect FAIL (including the vehicles 500 for the empty tenant).
- [ ] **Step 3:** Implement `tracking.js`; track/positions use `$queryRaw` with `ST_Y/ST_X(location::geometry)`; downsample with `row_number() % step`. Fix `fleet.js` by returning early / skipping the raw query when `vehicleIds` is empty.
- [ ] **Step 4:** Run — Expect PASS.
- [ ] **Step 5: Commit** — "feat(api): trips, track, devices, positions; fix empty-tenant vehicles list".

### Task 5: Operations API (maintenance, fuel, notifications) + user WS room

**Files:** Create `backend/src/routes/operations.js`, `backend/scripts/smoke/operations.test.js`; Modify `backend/src/ws/server.js`, `backend/src/index.js`.

**Interfaces:**
- Produces (WS): every authenticated socket also joins room `user:{userId}`; `emitToUser(userId: string, event: string, data: object): void` exported from `ws/server.js`.
- Produces (REST): `GET /fleet/maintenance?status&vehicleId` → `[{ id, vehicle:{id,vehicleNumber}, description, cost: number|null, serviceDate, status, createdAt }]`; `POST` `{ vehicleId, description, serviceDate, cost?, status? }`; `PUT/DELETE /fleet/maintenance/:id`. `GET /fleet/fuel?vehicleId` → `[{ id, vehicle, loggedBy:{id,name}, volume, totalCost, logDate }]`; `POST /fleet/fuel` `{ vehicleId, volume, totalCost, logDate? }` (loggedBy = caller); `DELETE /fleet/fuel/:id`. Notifications (any authenticated role, own only): `GET /fleet/notifications?unread=1` → `{ items:[{ id, title, message, isRead, createdAt }], unreadCount }`; `POST /fleet/notifications/:id/read`; `POST /fleet/notifications/read-all`; authority-only `POST /fleet/notifications` `{ userId, title, message }` → 201 and `emitToUser(userId,'notification.new', item)`.
- Rules: maintenance/fuel vehicle must be in tenant (422 `INVALID_VEHICLE`); `volume`,`totalCost` > 0 else 422; reading another user's notification → 404; `userId` of another tenant → 422.

- [ ] **Step 1: Write failing tests:** maintenance create (cost omitted → `cost:null`) → status filter → update to `completed` → delete; fuel create → list shows `loggedBy.name` of caller; `volume:0` → 422; driver token `GET /fleet/notifications` returns only that driver's items and `unreadCount` equals unread length; driver `POST …/:otherUsersNotificationId/read` → 404; `read-all` sets `unreadCount` 0; driver token `POST /fleet/notifications` → 403; authority sends to a KU driver then driver sees it unread; foreign-tenant `userId` → 422. WS: open a socket as the driver (`ws` package), send a notification, assert a `notification.new` message arrives within 2 s.
- [ ] **Step 2:** Run `npm run smoke -- --test-name-pattern=operations` — Expect FAIL.
- [ ] **Step 3:** Implement `operations.js` (per-route `authenticate()` vs `authenticate('AUTHORITY')`) and the `user:` room + `emitToUser`.
- [ ] **Step 4:** Run — Expect PASS.
- [ ] **Step 5: Commit** — "feat(api): maintenance, fuel, notifications and per-user ws room".

### Task 6: Administration API + driver edit/delete

**Files:** Create `backend/src/routes/admin.js`, `backend/scripts/smoke/admin.test.js`; Modify `backend/src/index.js`.

**Interfaces:**
- Produces: `GET /fleet/users` → `[{ id, name, email, phone, roles:string[], driverId:string|null, createdAt }]`; `POST /fleet/users` `{ name, email, phone?, password, roleId }` (bcrypt, 10 rounds); `PUT /fleet/users/:id` `{ name?, phone? }`; `PUT /fleet/users/:id/roles` `{ roleIds: string[] }`; `GET /fleet/roles` → `[{ id, name, description, isSystem, userCount, permissionCount }]`; `GET /fleet/permissions` → `[{ id, code, description }]`; `GET /fleet/roles/:id/permissions` → `[{ id, code, description }]`; `GET /fleet/subscription` → `{ current: {…}|null, history: […] }`; `GET/PUT /fleet/institution` (`{ id, name, slug, logoUrl }`; PUT edits `name`,`logoUrl` only). Drivers: `PUT /fleet/drivers/:id` (`name, phone, licenseNumber, licenseClass, licenseExpiry, employmentStatus, employeeCode, hiredAt`), `DELETE /fleet/drivers/:id`.
- Rules: duplicate email → 409; `roleId(s)` outside tenant → 422 `INVALID_ROLE`; must keep ≥1 role on a user; responses never include `passwordHash`; invalid `employmentStatus` → 422; deleting a driver with trips → 409; license number unique per tenant → 409; an authority cannot remove their own `AUTHORITY` role (422 `CANNOT_DEMOTE_SELF`).

- [ ] **Step 1: Write failing tests:** user create → appears in list with role name and no `passwordHash` key; new user can log in via `/auth/login`; duplicate email → 409; foreign-tenant `roleId` → 422; `PUT …/roles` swap works and self-demotion → 422; roles list shows `userCount`; `permissions` ≥6 and AUTHORITY role has all of them; `subscription.current.status === 'active'`; `PUT /institution` name round-trip (restore afterwards); driver update `employmentStatus:'on_leave'` then invalid `'sleeping'` → 422; delete a seeded driver with trips → 409.
- [ ] **Step 2:** Run `npm run smoke -- --test-name-pattern=admin` — Expect FAIL.
- [ ] **Step 3:** Implement `admin.js`.
- [ ] **Step 4:** Run — Expect PASS.
- [ ] **Step 5: Commit** — "feat(api): users, roles, subscription, institution, driver edit/delete".

### Task 7: Dashboard summary + trip WS events

**Files:** Create `backend/src/routes/dashboard.js`, `backend/scripts/smoke/dashboard.test.js`; Modify `backend/src/index.js`, `backend/src/routes/driver.js` (confirm `trip.started` is emitted via `emitVehicleEvent` next to `vehicle.status_changed`; add it if absent; `trip.ended` already exists).

**Interfaces:**
- Produces: `GET /fleet/dashboard/summary` → `{ totalVehicles, vehiclesByStatus:{idle,on_trip,maintenance,offline,retired}, activeTrips, devices:{active,inactive,faulty,retired,online}, upcomingMaintenance:[{id,vehicleNumber,description,serviceDate}] (next 5, status scheduled/in_progress, serviceDate ≥ today), fuelCost30d, tripsPerDay:[{date:'YYYY-MM-DD',count}] (14 entries, zero-filled, oldest first), fuelCostPerWeek:[{weekStart,cost}] (8, zero-filled), maintenanceCostByMonth:[{month:'YYYY-MM',cost}] (6, zero-filled), licenseExpiring:[{driverId,name,licenseExpiry}] (≤30 days) }`.

- [ ] **Step 1: Write failing tests:** `vehiclesByStatus` sums to `totalVehicles` (compare with `GET /fleet/vehicles` length); `tripsPerDay.length===14` and dates strictly ascending; `fuelCostPerWeek.length===8`; apex summary differs from KU's totals; empty tenant (from Task 4 helper) → all zeros/empty arrays, 200. Driver token → 403.
- [ ] **Step 2:** Run `npm run smoke -- --test-name-pattern=dashboard` — Expect FAIL.
- [ ] **Step 3:** Implement with grouped Prisma queries plus one raw SQL `date_trunc` query for the series; zero-fill in JS.
- [ ] **Step 4:** Run the full `npm run smoke` — Expect all suites PASS.
- [ ] **Step 5: Commit** — "feat(api): dashboard summary and trip.started event".

### Task 8: Design system, theme, shared client runtime

**Files:** Modify `website/style.css`, `website/app.js`.

**Interfaces:**
- Produces (`app.js`, globals): `API_BASE`/`WS_BASE` derived from `location` when host is not empty (`location.origin + '/api/v1'`, `ws(s)://host/ws`), fallback `http://localhost:3000`; `Api` gains automatic handling of 401 (`Auth.clear()` + redirect to `/index.html`) and `Api.get(path)` accepting query objects via `Api.qs({a:1})`; `Theme = { init(): void, toggle(): void, current(): 'light'|'dark' }` (stored in `localStorage` key `fs_theme`, defaults to `prefers-color-scheme`, sets `data-theme` on `<html>`); `WsManager.status` getter (`'connected'|'reconnecting'`) and `WsManager.on('status', fn)` firing on change; `Auth.role()` unchanged.
- Produces (CSS classes used by all later tasks): `.app-shell .sidebar .sidebar.collapsed .topbar .breadcrumbs .page .page-head .card .kpi .kpi-value .toolbar .chip(.active) .table .table-wrap .pagination .badge .badge-{idle,on_trip,maintenance,offline,retired,active,inactive,faulty,scheduled,in_progress,completed,cancelled,on_leave,suspended,terminated,trial,past_due,expired} .drawer .drawer.open .drawer-section .modal .form-grid .field .btn(.btn-primary|.btn-ghost|.btn-danger) .skeleton .empty .toast .dot-live .grid-2 .grid-3 .grid-4` plus light-theme token overrides under `[data-theme="light"]`.

- [ ] **Step 1:** Rework `style.css` tokens/components per the lists above, keeping existing class names used by driver/passenger pages working (check with grep before removing any). Add `@media (prefers-reduced-motion: reduce)` disabling animations.
- [ ] **Step 2:** Extend `app.js` per Interfaces; keep existing exports (`parseRoute`, `renderStepper`, `fmtTime`, `Toast`). Update `statusBadge(status)` to use the lowercase CHECK values and the new badge classes (old uppercase map was a bug against the v2 schema).
- [ ] **Step 3: Verify:** start the app (`npm run dev`), open `http://localhost:3000/index.html` and `/driver` in the browser pane; confirm the pages still render, no console errors, `Theme.toggle()` in the console flips `document.documentElement.dataset.theme` and colors change.
- [ ] **Step 4: Commit** `website/style.css website/app.js` — "feat(web): design system, theme, client runtime".

### Task 9: Console shell, router, shared UI components

**Files:** Replace `website/authority/index.html`; Create `website/authority/js/{main,router,ui}.js`.

**Interfaces:**
- Produces (`router.js`): `registerRoute(pattern: string, loader: () => Promise<{default: View}>): void` with patterns like `/fleet/vehicles`, `/fleet/vehicles/:id`; `navigate(path: string): void`; `startRouter(outlet: HTMLElement, ctx: object): void`. View contract: `{ title: string, render(ctx): Promise<HTMLElement>, destroy?(): void }`, where `ctx = { params, query, navigate, api: Api, ws: WsManager, ui }`. Unknown route → not-found empty state; `destroy()` of the previous view always runs before the next `render`.
- Produces (`ui.js`, named exports): `h(tag, attrs?, ...children): HTMLElement`; `badge(status: string): HTMLElement`; `dataTable({ columns:[{key,label,render?(row),sortable?}], rows, onRowClick?(row), pageSize=15 }): HTMLElement & { setRows(rows) }`; `filterBar({ search:true, chips:[{key,label}], onChange({q,chip}) }): HTMLElement`; `openDrawer({ title, subtitle?, sections:[{heading, content: Node}] }): void` / `closeDrawer(): void` (Esc closes, focus trapped, focus restored); `modalForm({ title, fields:[{name,label,type:'text'|'number'|'date'|'textarea'|'select',options?:[{value,label}],required?,hint?}], initial?, submitLabel?, onSubmit(values): Promise<void> }): void` (shows field-level errors from a thrown `err.code` + message and keeps the modal open); `confirmDialog(message: string): Promise<boolean>`; `skeleton(rows=5): HTMLElement`; `emptyState(title, hint?): HTMLElement`; `errorState(err, retry): HTMLElement`; `animateCount(el, to: number, ms=600): void` (instant when reduced motion); `fmtDate(iso)`, `fmtDateTime(iso)`, `fmtMoney(n)`, `fmtRelative(iso)`; `lineChart/barChart/doughnutChart(canvas, {labels, datasets})` thin Chart.js wrappers returning the chart (destroyed by caller).
- Shell: sidebar groups exactly as spec §3 (Overview, Fleet, Tracking, Operations, Administration) with active-state from the hash; topbar has breadcrumbs, search trigger (`Ctrl+K`, wired in Task 14), WS status dot, theme toggle, notification bell (count wired in Task 12), user menu with logout; sidebar collapse persists in `localStorage` (try/catch); under 900 px the sidebar becomes an overlay menu.

- [ ] **Step 1:** Build `index.html` (Leaflet + Chart.js CDN tags pinned to exact versions at least two weeks old, `<script type="module" src="js/main.js">`), `router.js`, `ui.js`, `main.js` (calls `Auth.require('AUTHORITY')`, `Theme.init()`, `WsManager.connect()`, registers all 16 routes with lazy `import()` of `./views/<name>.js`, `/` → `/overview/dashboard`).
- [ ] **Step 2:** Add a temporary stub view `views/dashboard.js` returning a card, to exercise the shell.
- [ ] **Step 3: Verify in browser:** log in as `authority@ku.edu.bd`; the shell loads at `#/overview/dashboard`; clicking each nav link changes the hash and shows the not-found state for unbuilt views (no uncaught errors); sidebar collapse and theme toggle work; at 375 px width the sidebar is an overlay; `Esc` closes a test drawer opened via the console (`(await import('/authority/js/ui.js')).openDrawer({...})`).
- [ ] **Step 4: Commit** — "feat(web): authority console shell, router, ui kit".

### Task 10: Fleet views (vehicles, models, drivers, routes, stops)

**Files:** Create `website/authority/js/views/{vehicles,models,drivers,routes,stops}.js`.

**Interfaces:** Consumes Task 2/3/6 endpoints, existing `/fleet/vehicles` (+ `/:id` PUT/DELETE, `/fleet/drivers` POST) and Task 9 UI kit. Each exports a default `View`. Routes: `/fleet/vehicles`, `/fleet/vehicles/:id` (opens drawer over list), `/fleet/models`, `/fleet/drivers`, `/fleet/drivers/:id`, `/fleet/routes`, `/fleet/routes/:id`, `/fleet/stops`.

- [ ] **Step 1: Vehicles.** Table (number, plate, model, status badge, driver, route, last seen), status chips from the vehicle enum, search. Drawer sections mirror the ER: *Model*, *Assignment* (driver/route links, both optional), *Devices*, *Recent trips*, *Maintenance*, *Fuel* (each fetched with the vehicle filter from Tasks 4/5; if an endpoint lacks the filter use client-side filtering of the list). Create/edit form keeps the old behaviour: driver/route selects have an explicit "None" option and warn when the chosen driver is already assigned to another vehicle. Delete uses `confirmDialog`; 409 shows the server message in a toast.
- [ ] **Step 2: Models, Drivers, Routes, Stops.** Models: global rows tagged "Global" with edit/delete hidden. Drivers: license-expiry badge (amber ≤30 days, red expired), employment status chips, linked login user shown in drawer, edit via Task 6 endpoints. Routes: list + drawer with an ordered stop editor (drag handle or up/down buttons, add stop from a select, save → `PUT /routes/:id/stops`) and a small Leaflet map with the stop polyline. Stops: table + a click-to-place map in the create/edit modal (lat/lng fields stay editable).
- [ ] **Step 3: Verify in browser** (KU authority): create → edit → delete a stop; build a route from 3 stops, reorder, reload and see the order persisted; assign a vehicle to no route/driver and confirm it saves; try deleting a stop used by a route and see the 409 toast; table search/filter/pagination work; no console errors; check 375 px width.
- [ ] **Step 4: Commit** the five view files — "feat(web): fleet screens".

### Task 11: Tracking views (live map, trips + replay, devices)

**Files:** Create `website/authority/js/views/{livemap,trips,devices}.js`; Delete `website/authority/fleet-map.html`.

**Interfaces:** Consumes `GET /fleet/positions`, WS events `location.update` (`data` carries `vehicleId`, `latitude`, `longitude`, `speed`, `heading`, `timestamp` per `driver.js`; read the emitter to confirm exact keys before coding), `vehicle.status_changed`, `trip.started`, `trip.ended`; trips/devices endpoints from Task 4. Routes: `/tracking/map`, `/tracking/trips`, `/tracking/trips/:id`, `/tracking/devices`.

- [ ] **Step 1: Live map.** Leaflet map fitted to markers; one marker per position with heading rotation and a `dot-live` pulse when not stale, dimmed when stale; side list of vehicles with status chips that pans the map on click; marker click → vehicle drawer (reuse a shared helper exported from `vehicles.js`). WS `location.update` moves markers without refetch; `trip.started/ended` and `vehicle.status_changed` refresh the affected row. `destroy()` removes WS handlers and the map.
- [ ] **Step 2: Trips + replay.** Table with status/vehicle/driver/date filters. Detail drawer shows summary and a map with the polyline from `/trips/:id/track`, a time slider with play/pause moving a marker, and speed readout; a trip with an empty track shows `emptyState('No GPS points recorded for this trip')` instead of the map.
- [ ] **Step 3: Devices.** Table with online/offline dot, status chips, firmware, last seen (`fmtRelative`); create/edit form (vehicle select, IMEI required); 409 duplicate IMEI shows a field error on `imei`.
- [ ] **Step 4: Verify in browser:** as KU authority open the live map, then in a second tab log in as the KU driver (`rahim@ku.edu.bd`), start a trip and post a location (UI or `POST /driver/trips/current/location`); the marker appears/moves in the authority tab without reload. Replay a seeded completed trip with the slider. Create a device with a duplicate IMEI and see the field error.
- [ ] **Step 5: Commit** — "feat(web): live map, trips replay, devices; remove old fleet-map page".

### Task 12: Operations views (maintenance, fuel, notifications) + bell

**Files:** Create `website/authority/js/views/{maintenance,fuel,notifications}.js`; Modify `website/authority/js/main.js` (bell wiring).

**Interfaces:** Consumes Task 5 endpoints and WS `notification.new`. Routes: `/operations/maintenance`, `/operations/fuel`, `/operations/notifications`. Produces in `main.js`: `refreshUnread(): Promise<void>` updating the bell badge; bell dropdown lists the latest 5 with mark-read and "View all".

- [ ] **Step 1:** Maintenance table + status chips + cost totals row; form with optional cost; vehicle drawer link. Fuel table with per-vehicle filter, totals for the visible rows, create form (logged-by is implicit). Notifications page: unread/all chips, mark-read, mark-all-read, and an authority "Send notification" form (user select from `/fleet/users`).
- [ ] **Step 2:** Wire the bell: initial `refreshUnread()`, increment + toast on WS `notification.new`.
- [ ] **Step 3: Verify in browser:** add maintenance and fuel records and see totals update; send a notification to the KU driver while the driver app is open in another tab (after Task 15 the driver page shows it; until then confirm via the authority bell by sending to self); mark read updates the badge.
- [ ] **Step 4: Commit** — "feat(web): operations screens and notification bell".

### Task 13: Administration views (users, roles, subscription, institution)

**Files:** Create `website/authority/js/views/{users,roles,subscription,institution}.js`.

**Interfaces:** Consumes Task 6 endpoints. Routes: `/admin/users`, `/admin/roles`, `/admin/subscription`, `/admin/institution`.

- [ ] **Step 1:** Users: table with role badges, create form (password + role select), role-assignment modal; linked driver shown as a link to the driver drawer. Roles: cards per role with `userCount`, and a permission matrix (permissions × roles, read-only checkmarks) with a note "Permissions are informational; access is role-based." Subscription: plan card with status badge, dates and days remaining, history table. Institution: name/logo form with live preview, slug read-only.
- [ ] **Step 2: Verify in browser:** create a user, log in as that user in a private window to confirm it works, demote attempt on self shows the server error; permission matrix matches `GET /fleet/roles/:id/permissions`; subscription shows seeded "Professional".
- [ ] **Step 3: Commit** — "feat(web): administration screens".

### Task 14: Dashboard and command palette

**Files:** Replace `website/authority/js/views/dashboard.js`; Create `website/authority/js/palette.js`; Modify `main.js` (Ctrl+K).

**Interfaces:** Consumes `GET /fleet/dashboard/summary`, `/fleet/positions`, WS `trip.started|trip.ended|vehicle.status_changed|location.update`. Produces `openPalette(): void` — lists screens (from the nav registry) and, after typing ≥2 chars, searches vehicles/drivers/routes/stops client-side from cached lists; arrow keys + Enter navigate; Esc closes.

- [ ] **Step 1:** Dashboard: KPI row with `animateCount` (total vehicles, active trips, devices online, 30-day fuel cost), fleet-status doughnut, trips-per-day line, fuel-cost-per-week bars, maintenance-cost-by-month bars, upcoming maintenance list, license-expiry list (links to driver drawer), mini live map snapshot. Refresh on relevant WS events (debounced 1 s) and every 60 s; clear timers in `destroy()`. Skeleton while loading; empty states for zero data.
- [ ] **Step 2:** Command palette per Interface.
- [ ] **Step 3: Verify in browser:** numbers match `GET /fleet/vehicles` counts; start a trip as a driver in another tab and see "active trips" tick up without reload; `Ctrl+K`, type "bus", Enter opens the vehicle drawer; dark and light themes both readable (charts re-read token colors on theme change).
- [ ] **Step 4: Commit** — "feat(web): dashboard and command palette".

### Task 15: Restyle login, driver and passenger apps

**Files:** Modify `website/index.html`, `website/driver/index.html`, `website/passenger/index.html`.

**Interfaces:** Consumes Task 8 CSS/`Theme`; behavior unchanged except: driver page lists its notifications (`GET /fleet/notifications`) with a bell and toast on WS `notification.new`; login uses `Auth.save` and `redirectTo` as before.

- [ ] **Step 1:** Restyle the three pages with the shared components (cards, badges, buttons, theme toggle), keep all existing element ids/handlers working (grep the inline scripts before renaming anything).
- [ ] **Step 2: Verify in browser:** login for each of the three seeded roles redirects correctly; driver can start trip, send location, end trip; passenger sees vehicle status/stepper; driver receives a notification sent from the authority console; 375 px width looks right in both themes.
- [ ] **Step 3: Commit** the three files — "feat(web): restyle login, driver and passenger apps".

### Task 16: Final verification and docs

**Files:** Modify `README.md` (how to run, screens map to ER views, smoke tests).

- [ ] **Step 1:** Run `npm run smoke` from `backend/` — Expect all suites PASS.
- [ ] **Step 2:** Walk every one of the 16 screens as KU authority and once as Apex authority (confirm Apex sees only its own data) at desktop and 375 px, in both themes; read the browser console after each screen — Expect zero errors.
- [ ] **Step 3:** Grep for leftovers: `grep -rn "fleet-map" website backend/src` — Expect none; `grep -rn "localhost:3000" website` — Expect only the documented fallback in `app.js`.
- [ ] **Step 4:** Update `README.md`; report results to the user with any screens/behaviors not verified.
- [ ] **Step 5: Commit** — "docs: README for ER-aligned console".
