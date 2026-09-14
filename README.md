# FleetSync

**A SaaS-Based Vehicle Management and Tracking System for Any Organization**

FleetSync is a multi-tenant SaaS platform that lets any organization — logistics providers, corporate fleets, ride-hailing operators, government motor pools, school transport, or delivery companies — register vehicles and drivers, track them in real time, and manage maintenance, fuel, and safety from one dashboard. Each subscribing organization's data is fully isolated, independently configurable, and independently billed.

> Course project — Dept. of Computer Science and Engineering, Khulna University
> Supervised by: Dr. Kazi Masudul Alam, Professor
> Status: **Week 1 — Initiation & SRS**

---

## Why this project

Commercial fleet platforms (Samsara, Verizon Connect / Fleetmatics, Geotab, Fleet Complete) prove the model works at scale, but they're built as single-tenant enterprise products with heavy onboarding. FleetSync is scoped around **self-service multi-tenancy** — any organization, regardless of size or technical maturity, can sign up, onboard its own fleet, and start tracking within minutes, with subscription tiers that gate feature access rather than requiring a sales conversation.

## Core features

- **Multi-tenant institutional onboarding** — multi-institution selection, secure credential login, strict data isolation between tenants
- **Consolidated Transportation Pool (Authority)** — exclusive control over vehicle fleet, route configuration via text box, driver assignment via dropdown, and activity status control
- **Instant real-time synchronization** — changes made to vehicle routes, drivers, or statuses reflect instantly on driver and passenger screens
- **Hardware-free real-time GPS tracking** — live transit tracking using HTML5 Geolocation API on drivers' smartphones (no OBD-II hardware needed)
- **Driver privacy protection** — trip-bound GPS tracking with automatic termination upon trip completion, clear status indicators, and zero off-duty tracking
- **Passenger live tracking portal** — vehicle number dropdown, interactive Leaflet map, smart route delimiter parser (visual milestone stepper), and one-touch driver calling (`tel:`)
- **Graceful signal fallback** — amber "Last Seen" badge with exact timestamp if cellular connection is lost mid-trip

See [`docs/SRS.md`](docs/SRS.md) and [`docs/FleetSync_SRS_Final.docx`](docs/FleetSync_SRS_Final.docx) for the full Software Requirements Specification.

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express / Next.js, PostgreSQL, row-level/tenant-scoped data isolation |
| Auth | JWT / Session (tenant-scoped), bcrypt |
| Mapping & Telemetry | Leaflet.js + OpenStreetMap, HTML5 Geolocation API, WebSockets / SSE for live sync |
| Frontend | Responsive HTML5 / CSS3 / Tailwind CSS, mobile-first PWA |

## Project structure

```
fleetsync/
├── backend/          # API services, tenant-scoped controllers, telemetry endpoint
├── website/          # Responsive web interface (Authority, Driver, Passenger consoles)
├── docs/
│   ├── FleetSync_SRS_Final.docx      # Finalized SRS Document (Word format)
│   ├── SRS.md                        # Finalized SRS Document (Markdown, IEEE Std 830)
│   └── generate_docx.py              # Script to build docx from specification
└── README.md
```

## Getting started

```bash
# Backend
cd backend
npm install
npm run dev          # starts API on localhost:3000

# Website
cd website
# no build step — open index.html or serve with any static server
npx serve .
```

Demo accounts (seeded organization): email `admin@demo-org.test` / `manager@demo-org.test` / `dispatcher@demo-org.test`, password `demopass123`.

## Team (Week 1)

| Member | Student ID |
|---|---|
| Sidratul Muntaha | 210208 |
| GM Aman Ullah | 220225 |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for branch naming, commit conventions, and PR review rules.

## Roadmap

- [x] **Week 1 — Initiation & SRS**: scope/objectives/roles, SRS draft, GitHub repo + contribution guidelines, README + initial task list
- [ ] **Week 2 — Design & Planning**: UI wireframes, architecture documentation (ER diagrams, flowcharts), GitHub Projects board
- [ ] **Week 3–4 — Development Sprint 1**: core modules (auth, tenant onboarding, basic UI), scaffolding, unit tests, PR-based peer review
- [ ] **Week 5–6 — Development Sprint 2**: CRUD operations, forms, API integration, sprint velocity tracking, retrospectives

## License

TBD (course project — add a license before any public/production use).
