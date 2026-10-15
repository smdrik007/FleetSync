# FleetSync — Web Software Development Presentation Q&A

> **For poster viva — HOW you built the software, not just the database.**

---

## Part 1: "What is This Project?"

### Q1. "Introduce your project."
> FleetSync is a **multi-tenant web-based vehicle management and real-time GPS tracking SaaS platform**. It lets any organization register vehicles and drivers, track them live on an interactive map, and manage maintenance, fuel, and notifications — all through a browser with three role-based interfaces (Authority, Driver, Passenger).

### Q2. "Is this a web application or a website?"
> This is a **web application**. A website just displays information. A web application is **interactive** — users log in, perform CRUD operations, see real-time data updates, and interact with maps, charts, and forms. FleetSync has:
> - A **backend server** (Node.js/Express) with business logic
> - A **REST API** with 40+ endpoints
> - **Real-time WebSockets** for live GPS tracking
> - **Role-based authentication** with JWT
> - A **single-page application** for the authority console

### Q3. "How does this software work from a user's perspective?"
> 1. User opens the app → sees a **landing page**
> 2. Selects their institution → enters email + password → **login**
> 3. Based on role, they are redirected to:
>    - **Authority** → Full dashboard SPA with 16 screens
>    - **Driver** → Mobile-first app to start/end trips and share live GPS
>    - **Passenger** → Live tracking page to watch a vehicle on the map
> 4. All three apps receive **real-time updates** via WebSocket — no page refresh needed

### Q4. "Who are the users/roles?"
> 3 roles:
> - **AUTHORITY** — admin. Manages vehicles, drivers, routes, maintenance, fuel, users, roles, and full dashboard.
> - **DRIVER** — starts/ends trips, sends live GPS, receives notifications. GPS **stops automatically** when trip ends (privacy).
> - **PASSENGER** — selects a vehicle, sees live position on map, sees route stepper, can call driver directly.

---

## Part 2: Software Architecture

### Q5. "What architecture pattern does your project follow?"
> **Client-server** with REST API + WebSocket:
> ```
> Browser (Authority SPA / Driver App / Passenger App)
>         ↕  HTTP REST + WebSocket
> Express.js Server (Middleware → Routes → WebSocket Engine → Prisma ORM)
>         ↕
> PostgreSQL + PostGIS
> ```

### Q6. "What is frontend vs backend in your project?"
> **Backend** (`backend/` folder) — runs on the server (Node.js): handles authentication, business logic, database queries, serves API and WebSocket. Files: `src/routes/*.js`, `src/middleware/*.js`, `src/ws/server.js`.
>
> **Frontend** (`website/` folder) — runs in the browser (JavaScript): makes HTTP requests via `fetch()`, connects to WebSocket, renders the UI. Files: `app.js`, `style.css`, `authority/js/*.js`, `driver/`, `passenger/`. **No build step** — served as static files by Express.

### Q7. "Why is your frontend served by the backend?"
> **Monolithic deployment** for simplicity:
> - Express serves API routes AND static frontend from the same port (3000)
> - `app.use(express.static(websiteDir))` serves HTML/CSS/JS directly
> - No CORS issues (same-origin), one `npm run dev` starts everything
> - API base URL auto-detects: `location.host ? location.origin + '/api/v1' : 'http://localhost:3000/api/v1'`

### Q8. "Explain your project structure."
> ```
> FleetSync/
> ├── backend/
> │   ├── prisma/schema.prisma   # 19 models, 465 lines
> │   ├── src/
> │   │   ├── index.js           # Express entry — mounts all routers
> │   │   ├── routes/            # 10 route files (auth, fleet, catalog, network, tracking, operations, admin, dashboard, driver, passenger)
> │   │   ├── middleware/        # auth.js (JWT), error.js (Prisma error mapping)
> │   │   ├── ws/server.js       # WebSocket engine — room-based broadcasting
> │   │   ├── db/                # Prisma client, seed.js, seed-demo.js
> │   │   └── lib/http.js        # Helpers: bad(), assertEnum(), wrap()
> │   └── scripts/smoke/         # API smoke tests
> ├── website/
> │   ├── style.css              # Design system (44KB — tokens, components, themes)
> │   ├── app.js                 # Shared runtime (Auth, Api, WsManager, Theme, Toast)
> │   ├── authority/             # SPA console — hash router + 17 view modules
> │   ├── driver/                # Driver mobile-first app
> │   └── passenger/             # Passenger tracking portal
> └── docs/                      # ER diagrams, SQL schema, API contracts
> ```

---

## Part 3: Tech Stack

### Q9. "What technologies did you use?"

| Layer | Technology | Why |
|---|---|---|
| **Runtime** | **Node.js + Express** | Event-driven, non-blocking I/O for real-time apps |
| **Database** | **PostgreSQL + PostGIS** | Relational integrity + geographic point storage |
| **ORM** | **Prisma 5** | Type-safe queries + raw SQL for PostGIS |
| **Auth** | **JWT + bcrypt** | Stateless auth, secure password hashing |
| **Real-time** | **WebSocket (`ws`)** | Bi-directional, low-latency GPS updates |
| **Frontend** | **Vanilla JS (ES Modules)** | No build step, no React/Vue needed |
| **Maps** | **Leaflet.js + OpenStreetMap** | Open-source interactive maps |
| **Charts** | **Chart.js** | Doughnut, line, bar charts for dashboard |
| **CSS** | **Custom design system** | CSS custom properties, dark/light themes |

### Q10. "Why Node.js instead of Django or Spring Boot?"
> Node.js is **event-driven and non-blocking** — ideal for WebSocket connections. Express is minimal. JavaScript on both frontend and backend keeps the stack unified. Django would need Django Channels for WebSockets. Spring Boot is heavy for this scope.

### Q11. "Why no React/Vue/Angular?"
> Our goal was **no frontend build step** — the `website/` folder is served directly by Express. We built our own hash router, UI component library, and lazy-loaded ES modules. It behaves like a SPA without webpack/vite. Simpler deployment, fewer dependencies.

---

## Part 4: Backend Development (Express.js)

### Q12. "What is Express.js and why?"
> Express is a **minimal web framework** for Node.js. We chain middleware functions: CORS → JSON parser → Auth → Route handler → Error handler. It supports both REST and WebSocket on the same server.

### Q13. "What is middleware? Name yours."
> Middleware = function that runs between request and response. Ours:
> 1. **CORS** — `cors({ origin: '*' })` allows cross-origin requests
> 2. **Body Parser** — `express.json()` parses JSON body into `req.body`
> 3. **Authentication** — `authenticate('AUTHORITY')` verifies JWT, attaches `req.user`
> 4. **Error Handler** — catches thrown errors, maps Prisma codes to HTTP status

### Q14. "How does the request-response lifecycle work?"
> Example — Authority loads dashboard:
> 1. Browser: `GET /api/v1/fleet/dashboard/summary` with `Authorization: Bearer eyJ...`
> 2. Express: CORS → JSON parser → `authenticate('AUTHORITY')` verifies JWT → `req.user = { sub, institutionId, role }`
> 3. Route handler queries Prisma: `WHERE institutionId = req.user.institutionId`
> 4. Prisma → PostgreSQL → returns data → handler wraps in `{ success: true, data }`
> 5. If error: `next(err)` → errorHandler sends `{ success: false, error: { code, message } }`

### Q15. "How did you organize routes?"
> 10 route files, each one domain. All fleet routes mount under `/api/v1/fleet`:
> ```javascript
> app.use('/api/v1',          authRouter);       // login, logout, me
> app.use('/api/v1/fleet',    fleetRouter);      // vehicles
> app.use('/api/v1/fleet',    catalogRouter);    // vehicle models
> app.use('/api/v1/fleet',    networkRouter);    // routes, stops
> app.use('/api/v1/fleet',    trackingRouter);   // trips, GPS, devices
> app.use('/api/v1/fleet',    operationsRouter); // maintenance, fuel, notifications
> app.use('/api/v1/fleet',    adminRouter);      // users, roles, subscription
> app.use('/api/v1/fleet',    dashboardRouter);  // analytics
> app.use('/api/v1/driver',   driverRouter);     // driver trip lifecycle
> app.use('/api/v1/passenger', passengerRouter); // passenger vehicle lookup
> ```

### Q16. "How do you handle errors?"
> 3 layers:
> - **Validation**: `if (!make) → 422 MISSING_FIELDS`
> - **Enum check**: `assertEnum(status, ['idle','on_trip',...], 'status')` → 422 INVALID_STATUS
> - **Prisma mapping**: `P2002` → 409 DUPLICATE, `P2003` → 409 HAS_DEPENDENTS
> - All responses: `{ success: true, data }` or `{ success: false, error: { code, message } }`

---

## Part 5: Frontend Development

### Q17. "How did you build the frontend without a framework?"
> Custom SPA framework with 3 core modules:
>
> **`app.js`** (globals): `Auth` (JWT in localStorage), `Api` (fetch wrapper with auto-token), `WsManager` (WebSocket with reconnection), `Theme` (dark/light), `Toast` (notifications)
>
> **`router.js`** (hash-based SPA router): listens for `hashchange`, matches patterns like `/fleet/vehicles/:id`, lazy-loads views with `import()`, calls `destroy()` on previous view
>
> **`ui.js`** (component library, 577 lines): `h()` DOM builder, `dataTable()`, `modalForm()`, `openDrawer()`, `filterBar()`, `kpiCard()`, Chart.js wrappers

### Q18. "What is a Single Page Application? How does yours work?"
> SPA loads **one HTML page** and updates content without full reloads. Our approach:
> - URL: `http://localhost:3000/authority#/fleet/vehicles`
> - The `#/fleet/vehicles` is the **hash** — changing it doesn't reload the page
> - `router.js` listens for `hashchange` → matches pattern → lazy-loads view module → calls `render()` → replaces content area
> - Each view module exports: `{ title, render(ctx), mounted(ctx), destroy(id) }`

### Q19. "What is lazy loading? How?"
> Loading code **only when needed**:
> ```javascript
> registerRoute('/fleet/vehicles', () => import('./views/vehicles.js'));
> ```
> First visit to "Vehicles" downloads the file. Cached after that. Initial page load is fast — only shell + current view loaded, not all 17 views.

### Q20. "Explain the `h()` function."
> DOM element factory — like `React.createElement` but vanilla:
> ```javascript
> // Instead of 5 lines of createElement/appendChild:
> h('div', { class: 'card', onclick: handleClick },
>   h('h1', {}, 'Hello'),
>   h('p', {}, 'World'))
> ```
> Handles classes, events, data attributes, styles, and children.

### Q21. "How does the dataTable component work?"
> ```javascript
> dataTable({
>   columns: [
>     { key: 'vehicleNumber', label: 'Vehicle', sortable: true },
>     { key: 'status', label: 'Status', render: (row) => badge(row.status) }
>   ],
>   rows: data,
>   onRowClick: (row) => openDrawer(row.id),
>   pageSize: 15
> });
> ```
> - Click header → sort. Client-side pagination (15 per page). `setRows()` updates without recreating.

### Q22. "How do modal forms work?"
> `modalForm()` generates fields from config (text, number, date, select). On submit → calls `onSubmit()` → if API throws, modal **stays open** with field-level error. Esc/outside-click closes. Focus trapped (accessibility).

### Q23. "What are the 16 screens in the Authority console?"
> Dashboard (KPIs, charts, map) · Vehicles · Models · Drivers · Routes · Stops · Live Map · Trips (GPS replay) · Devices · Maintenance · Fuel Logs · Notifications · Users · Roles · Subscription · Institution

---

## Part 6: REST API Design

### Q24. "What is a REST API?"
> REST = Representational State Transfer. Resources identified by URLs, HTTP methods map to CRUD:
> - `GET /fleet/vehicles` → list, `POST` → create, `PUT /:id` → update, `DELETE /:id` → delete
> - Stateless — each request carries its own auth token

### Q25. "API examples?"
> | Method | Endpoint | Purpose |
> |--------|----------|---------|
> | POST | `/auth/login` | Login |
> | GET | `/fleet/vehicles` | List vehicles (tenant-scoped) |
> | PUT | `/fleet/routes/:id/stops` | Reorder stops |
> | GET | `/fleet/trips/:id/track` | GPS replay points |
> | GET | `/fleet/positions` | Live positions |
> | GET | `/fleet/dashboard/summary` | Dashboard data |
> | POST | `/driver/trips/start` | Driver starts trip |
> | POST | `/driver/trips/:id/location` | Driver sends GPS |

### Q26. "Why consistent response format?"
> Every response: `{ success: true, data }` or `{ success: false, error: { code, message } }`. The frontend `Api` client handles all responses uniformly — caller always gets clean data or a thrown error.

---

## Part 7: WebSocket / Real-Time

### Q27. "Why WebSocket instead of HTTP polling?"
> HTTP polling: `setInterval(fetch, 5000)` → 12 requests/min/client. 50 users = 600 pointless API calls/minute, 5s delay.
> WebSocket: one persistent connection, server pushes **only when data changes**, under 100ms latency.

### Q28. "How does your WebSocket server work?"
> Room-based pub/sub (`ws/server.js`):
> - `institution:{id}` — all users of that org (authority sees all)
> - `vehicle:{id}` — passengers watching that vehicle
> - `user:{id}` — personal notifications
> - `driver:{id}` — driver's own events
>
> Client authenticates via `?token=<JWT>`. Auto-joins rooms. Server broadcasts to relevant rooms only — passengers watching Vehicle A don't see Vehicle B's GPS.

### Q29. "How does reconnection work?"
> Exponential backoff: disconnect → wait 1s → retry → fail → 2s → 4s → 8s → max 15s. On success: reset to 1s, re-subscribe to watched vehicles. Topbar shows "Live" (green) or "Reconnecting" (amber) status dot.

---

## Part 8: Real-Time GPS Tracking

### Q30. "How does GPS tracking work without hardware?"
> **HTML5 Geolocation API** on driver's phone:
> ```javascript
> navigator.geolocation.watchPosition((pos) => {
>   Api.post(`/driver/trips/${tripId}/location`, {
>     latitude: pos.coords.latitude,
>     longitude: pos.coords.longitude,
>     speed: pos.coords.speed
>   });
> });
> ```
> Backend stores in `gps_logs` (PostGIS), updates `vehicle_latest_position`, broadcasts via WebSocket to live map and passenger tracking. GPS **stops when trip ends** (driver privacy).

### Q31. "How does the live map work?"
> 1. Load: `GET /fleet/positions` → create Leaflet markers
> 2. WebSocket: `location.update` event → `marker.setLatLng()` — marker slides to new position
> 3. Stale vehicles (>5 min) appear dimmed
> 4. `destroy()` removes WS handlers + map instance (no memory leak)

### Q32. "How does trip replay work?"
> `GET /trips/:id/track` → up to 2000 GPS points (downsampled if more) → Leaflet polyline + time slider with play/pause. A trip with zero GPS points shows an empty state message.

---

## Part 9: Authentication

### Q33. "Complete login flow?"
> 1. User selects institution → enters email + password
> 2. `POST /auth/login` → backend finds user, `bcrypt.compare()` password
> 3. Signs JWT: `{ sub: userId, institutionId, role }`, 24h expiry
> 4. Frontend: `Auth.save(token, user)` → localStorage → redirect by role
> 5. Authority page: `Auth.require('AUTHORITY')` → WsManager.connect() with token

### Q34. "What is JWT? Why not sessions?"
> JWT = stateless token containing identity (user ID, institution, role), signed with a secret. Benefits: no session store needed, works with WebSocket (`?token=` query param), any server instance can verify. Sessions need Redis and don't work well with WebSockets.

### Q35. "How do you protect frontend routes?"
> `Auth.require('AUTHORITY')` checks localStorage for token and role. Wrong role → redirect. Expired token → `Api` receives 401 → `Auth.clear()` → redirect to login.

---

## Part 10: CSS & Design System

### Q36. "How does your CSS design system work?"
> CSS Custom Properties as design tokens:
> ```css
> :root { --bg: #0b0e17; --surface: #121623; --accent: #5b8def; --radius: 10px; }
> ```
> All components use `var(--surface)`, `var(--text)`. Changing one token updates every component.

### Q37. "How does dark/light theme switching work?"
> Default is dark (`:root`). Light theme overrides: `[data-theme="light"] { --bg: #f4f6fb; }`. JavaScript: `Theme.toggle()` flips `data-theme` on `<html>` + saves to localStorage. All components re-theme instantly.

### Q38. "How is it responsive?"
> CSS Grid + Flexbox, no fixed widths. Below 900px: sidebar becomes overlay menu. At 375px: all screens usable. Driver/passenger apps are mobile-first. Respects `prefers-reduced-motion`.

### Q39. "What font?"
> **Inter** from Google Fonts — designed for screens, clean at small sizes, supports tabular numbers for KPI cards.

---

## Part 11: Multi-Tenancy

### Q40. "How does multi-tenancy work?"
> Every tenant-scoped table has `institution_id`. JWT contains `institutionId`. **Every API query** filters by `req.user.institutionId` — tenant never accepted from request body. Database has composite unique keys (`@@unique([institutionId, id])`). Another tenant's resource → 404 (not 403).

---

## Part 12: Database (Brief)

### Q41. "Database and ORM?"
> PostgreSQL + PostGIS, 19 tables. Prisma ORM for standard CRUD, raw SQL for PostGIS spatial queries (`ST_MakePoint`, `ST_X`, `ST_Y`).

### Q42. "What is database seeding?"
> Populating the DB with demo data. `npm run db:seed` creates 2 institutions, users per role, vehicles, routes, trips with GPS points, maintenance, fuel logs. **Idempotent** — safe to run multiple times.

---

## Part 13: Testing

### Q43. "How did you test?"
> **API smoke tests** (Node.js `node:test`): auth, CRUD for every entity, tenant isolation (KU can't see Apex data), validation (wrong enum → 422), dependent records (delete with children → 409), empty tenant (zero vehicles → `[]` not 500). **Frontend tested manually** at desktop + 375px, both themes, two tenants, real-time with two-tab driver+authority test.

---

## Part 14: Software Engineering

### Q44. "What design patterns?"
> - **MVC** (loosely): Prisma = Model, Views = Frontend, Routes = Controller
> - **Middleware pattern**: Express pipeline
> - **Pub/Sub**: WebSocket rooms
> - **Factory**: `h()`, `modalForm()`
> - **Module pattern**: ES module views with render/destroy lifecycle
> - **Singleton**: Prisma client, WsManager, Auth, Theme

### Q45. "npm packages used?"
> express, @prisma/client, jsonwebtoken, bcryptjs, ws, cors, dotenv, uuid, nodemon (dev), prisma (dev). CDN: Leaflet, Chart.js.

### Q46. "How do you prevent memory leaks?"
> Every view: `destroy()` clears intervals, removes WS handlers, destroys Leaflet maps and Chart.js instances. Router uses token counter for race condition protection.

---

## Part 15: Tricky Questions

### Q47. "Two drivers start trip for same vehicle?"
> Backend checks: `findFirst({ where: { vehicleId, status: 'in_progress' } })`. Second driver → 409 TRIP_ALREADY_ACTIVE.

### Q48. "Security vulnerabilities?"
> (Being honest impresses teachers)
> 1. JWT in localStorage — XSS risk (should use httpOnly cookies)
> 2. CORS open to all origins — should restrict
> 3. No rate limiting on login
> 4. No HTTPS in dev
> 5. JWT secret needs strong random value in production

### Q49. "What would you change for production?"
> httpOnly cookies, rate limiting, HTTPS, Redis for WS scaling, connection pooling, CI/CD, logging, Nginx reverse proxy, frontend on CDN.

### Q50. "Why `ws` not Socket.IO?"
> `ws` is lightweight, pure WebSocket protocol, 0 dependencies. Socket.IO adds overhead (custom protocol, fallback polling, client library). We built our own room system.

---

## Quick Numbers

| Metric | Value |
|--------|-------|
| Route files | 10 |
| API endpoints | ~40+ |
| View modules | 17 |
| CSS | 44KB, 585 lines |
| UI library | 577 lines, 20+ components |
| DB tables | 19 |
| npm packages | 8 runtime + 2 dev |
| WS events | 5 types |
| Roles | 3 |
| Demo tenants | 2 |

---

## Presentation Tips

1. **Demo it** — have the app running. Show live map, start a trip as driver in another tab.
2. **Know your flows** — login flow, GPS tracking flow, notification flow
3. **Architecture diagram** — Client → REST + WebSocket → Express → PostgreSQL
4. **Admit limitations** — shows engineering maturity (Q48, Q49)
5. **Use the right terms** — SPA, REST API, WebSocket, JWT, ORM, middleware, design tokens, lazy loading
