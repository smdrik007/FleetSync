# FleetSync

**A SaaS-Based Vehicle Management and Tracking System for Any Organization**

FleetSync is a multi-tenant SaaS platform that lets any organization — logistics providers, corporate fleets, school and university transport, care homes, or delivery companies — track its vehicles or people in real time and manage drivers, routes, maintenance, fuel and costs from one console. Each subscribing organization's data is fully isolated, independently configurable, and independently billed.

> Course project — Dept. of Computer Science and Engineering, Khulna University
> Supervised by: Dr. Kazi Masudul Alam, Professor
> Status: **Working prototype** — web app, Android app, device ingest API and ESP32 tracker firmware

---

## Why this project

Commercial fleet platforms (Samsara, Verizon Connect / Fleetmatics, Geotab, Fleet Complete) prove the model works at scale, but they're built as single-tenant enterprise products with heavy onboarding. FleetSync is scoped around **self-service multi-tenancy** — any organization, regardless of size or technical maturity, can sign up, onboard its own fleet, and start tracking within minutes, with subscription tiers that gate feature access rather than requiring a sales conversation.

## Core features

- **Self-service sign-up** — a 14-day trial from `/signup.html`; each institution picks a **tracking type** (vehicles, people or things) that decides which screens and APIs it gets
- **Multi-tenant isolation** — every record is scoped to the signed-in institution; roles `AUTHORITY`, `DRIVER`, `PASSENGER` and `GUARDIAN` decide access
- **Authority console** — vehicles, models, drivers, routes with ordered stops, live map, trip replay, devices, maintenance, fuel logs, costs, notifications, users, subscription and institution settings
- **Real-time sync** — route, driver and status changes and every new position reach driver, passenger and guardian screens over WebSocket
- **Phone GPS tracking** — the driver's phone (web or Android app) reports only while a trip is in progress, with automatic stop on trip completion and no off-duty tracking
- **Hardware trackers** — any GPS device can report through the ingest API with its own per-device key: ESP32 microcontrollers (HTTP JSON), Traccar Client / OsmAnd phone apps, and bands or trackers forwarded by a Traccar gateway
- **People tracking** — tracked people need recorded consent, can be paused, have circular safe zones with in-app alerts and SOS, and are followed by guardians from the `/guardian` page
- **Passenger portal** — vehicle picker, live map, route milestone stepper, ETA to the next stops, and one-touch driver calling (`tel:`)
- **Trip distance and cost** — distance per trip, estimated fuel per trip, and fuel + maintenance spend totals per tenant
- **Graceful signal fallback** — amber "Last Seen" badge with the exact time when a vehicle stops reporting; the Android app queues fixes offline and resends them

See [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md) for the API and [`docs/fleetsync_er_schema.md`](docs/fleetsync_er_schema.md) for the data model.

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express, Prisma, PostgreSQL, `ws` WebSocket server, tenant-scoped queries |
| Auth | JWT, bcrypt, login throttling; per-device API keys (stored as SHA-256 hashes) for trackers |
| Web app | No-build HTML / CSS / ES modules served by the backend, Leaflet + OpenStreetMap |
| Android app | Expo SDK 57 (React Native, expo-router), MapLibre, background location with an SQLite offline queue |
| Hardware | ESP32 + NEO-6M GPS + SIM800L (2G GPRS), Arduino sketch |

## Project structure

```
fleetsync/
├── backend/                 # Express API, Prisma schema, WebSocket engine
│   ├── prisma/              # schema.prisma + migrations
│   ├── src/routes/          # auth, fleet, catalog, network, tracking, operations, admin,
│   │                        # dashboard, driver, passenger, ingest, people, guardian(s)
│   ├── src/lib/             # positions, ETA, alerts, device keys, tracking-type gate
│   ├── src/db/              # Prisma client, seed.js (demo data for every screen)
│   └── scripts/             # smoke/ API tests (node:test), tunnel.ps1, maintenance scripts
├── website/                 # No-build web app, served by the backend
│   ├── landing.html         # Public landing page (served at /)
│   ├── index.html           # Sign in
│   ├── signup.html          # Create an institution (14-day trial)
│   ├── authority/           # Authority console (single-page, hash router, ES modules)
│   ├── driver/  passenger/  # Mobile-first driver and passenger pages
│   ├── guardian/            # Guardian page for people tracking
│   └── style.css  app.js    # Shared design system (dark + light) and client runtime
├── mobile/                  # Android app (Expo): driver, passenger and authority screens
├── firmware/esp32-tracker/  # ESP32 vehicle tracker sketch (posts to the ingest API)
├── docs/                    # ER diagram, schema, API contracts, poster
└── README.md
```

## Getting started

```bash
cd backend
cp .env.example .env   # set DATABASE_URL and JWT_SECRET
npm install
npm run db:seed        # tenants, users, and demo data for every screen (safe to re-run)
npm run dev            # API + web app on http://localhost:3000
npm run smoke          # API smoke tests (needs the API running; set API_BASE for another port)
```

Optional environment variables: `TRACCAR_FORWARD_SECRET` (turns on `/api/v1/ingest/traccar`), `SIGNUPS_PER_HOUR`, `LOCATION_STALE_MS`, `JWT_EXPIRES_IN`.

Open <http://localhost:3000>, pick an institution and sign in. Seeded demo accounts (password `demo1234`):

| Institution | Role | Email |
|---|---|---|
| Khulna University | Authority | `authority@ku.edu.bd` |
| Khulna University | Driver | `rahim@ku.edu.bd`, `karim@ku.edu.bd` |
| Khulna University | Passenger | `passenger@ku.edu.bd` |
| Sunrise Care Home (tracks **people**) | Authority | `authority@sunrise.demo` |
| Sunrise Care Home | Guardian (follows "Aisha Rahman") | `guardian@sunrise.demo` |
| Apex Logistics Co. | Authority | `authority@apex.com` |
| Apex Logistics Co. | Driver / Passenger | `sumon@apex.com`, `rafiq@apex.com` / `passenger@apex.com` |

To reach the backend from a phone or tracker outside your network, `backend/scripts/tunnel.ps1` opens a free Cloudflare quick tunnel. The demo accounts are reachable through it, so don't share the URL widely.

### Android app

```bash
cd mobile
npm install
npx expo run:android   # dev client build; Expo Go can't run background location
```

The server address can be changed inside the app ("Server: … Change" on the login screen).

### GPS trackers

1. In the authority console, open **Tracking → Devices**, add a device, pick its type and attach it to a vehicle or person. The device key is shown **once**.
2. Point the device at the address and key shown in its setup text:

| Device type | Endpoint |
|---|---|
| ESP32 / Arduino | `POST /api/v1/ingest/json` with `Authorization: Bearer <key>`; one point or an array of up to 500 |
| Traccar Client / OsmAnd app | `GET` or `POST /api/v1/ingest/osmand?key=<key>` |
| Bands and trackers via Traccar | Traccar forwards to `POST /api/v1/ingest/traccar` with the `X-Forward-Secret` header |

The ESP32 sketch, parts list and wiring are in [`firmware/esp32-tracker/esp32-tracker.ino`](firmware/esp32-tracker/esp32-tracker.ino).

## Authority console ↔ ER diagram

The console is organised by the four views of the ER diagram (`docs/fleetsync_er_schema.md`). Vehicle tenants see the fleet screens; people and things tenants see People, Guardians and Devices instead.

| Section | Screens | Tables |
|---|---|---|
| Overview | Dashboard (KPIs, charts, live map snapshot) | cross-view aggregates |
| Fleet | Vehicles, Vehicle Models, Drivers, Routes (ordered stops), Stops | `vehicles`, `vehicle_models`, `drivers`, `routes`, `route_stops`, `stops` |
| Tracking | Live Map, Trips (GPS replay), People, Guardians, Devices | `vehicle_latest_position`, `trips`, `gps_logs`, `assets`, `devices` |
| Operations | Maintenance, Fuel Logs, Costs, Notifications | `maintenance_records`, `fuel_logs`, `notifications` |
| Administration | Users, Subscription, Institution | `users`, `user_roles`, `roles`, `subscriptions`, `institutions` |

Press **Ctrl/⌘ + K** anywhere in the console to jump to a screen or find a vehicle, driver, route or stop.

## Team

| Member | Student ID |
|---|---|
| Sidratul Muntaha | 210208 |
| GM Aman Ullah | 220225 |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for branch naming, commit conventions, and PR review rules.

## Not built yet

- A deployed Traccar gateway and a tested wristband (the `/ingest/traccar` endpoint is written from Traccar's docs)
- SMS and push notifications (alerts are in-app only)
- A Play Store release (the APK is signed with a debug keystore)
- Public hosting (the backend runs locally; use the tunnel to reach it from outside)

## License

TBD (course project — add a license before any public/production use).
