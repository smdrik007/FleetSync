# FleetSync — Task List / Backlog

Generated as part of Week 1 initiation. Convert each item into a GitHub Issue as work begins; keep this file as the source-of-truth backlog and check items off as they're completed.

Legend: `[H]` High priority · `[M]` Medium · `[L]` Low — mirrors SRS requirement priorities.

---

## Week 1 — Initiation & SRS

- [x] Define project scope, objectives, and team roles
- [x] Draft SRS document (AI-assisted, team-reviewed) — `docs/FleetSync_SRS_v0.1.docx`
- [ ] Create GitHub repository, add collaborators, protect `main` branch
- [x] Add `README.md`, `CONTRIBUTING.md`, `.gitignore`
- [x] Create folder scaffold: `backend/`, `website/`, `mobile/`, `docs/`, `scripts/`
- [ ] Team review pass on SRS — confirm/adjust requirement priorities before Week 2
- [ ] Set up shared task board (GitHub Projects) mirroring this file

## Week 2 — Design (proposed)

- [ ] `[H]` Entity-Relationship Diagram covering: organizations, users, vehicles, drivers, trips, geofences, maintenance_records, fuel_logs, driving_events
- [ ] `[H]` API contract (routes, request/response shapes) for all modules in SRS §3
- [ ] `[H]` System architecture diagram (client / service / data / tracking-ingestion layers)
- [ ] `[M]` Wireframes: org onboarding flow, fleet manager dashboard, live map view, driver mobile app
- [ ] `[H]` Choose mapping/routing provider (Google Maps vs. OpenStreetMap + routing engine) and confirm free/low-tier limits are sufficient for development
- [ ] `[L]` Draft GPS ingestion message format spec (device payload schema)

## Week 3+ — Implementation backlog (by module)

### Backend core
- [ ] `[H]` Auth: JWT issuing/verification scoped per organization, bcrypt password hashing
- [ ] `[H]` Organization self-registration with subscription-tier selection
- [ ] `[H]` Tenant-isolation middleware — enforce organization scoping on every data-access query
- [ ] `[H]` Role-based dashboard routing on login (Admin / Fleet Manager / Dispatcher / Driver)

### Vehicle & driver management
- [ ] `[H]` Vehicle registration endpoint (make, model, registration number, type)
- [ ] `[H]` Vehicle document upload + expiry tracking (registration, insurance, fitness certificate)
- [ ] `[H]` Driver registration + license expiry tracking and pre-expiry flagging
- [ ] `[H]` Driver-vehicle assignment with double-assignment lock during active trips
- [ ] `[M]` Vehicle/driver search (by registration number, name, status, route)
- [ ] `[M]` Inactive/retire flow that preserves historical trip and maintenance data

### Tracking & geofencing
- [ ] `[H]` GPS ingestion endpoint (REST/MQTT), configurable ping interval
- [ ] `[H]` Live fleet map view with status filters (moving, idle, offline)
- [ ] `[H]` Geofence CRUD (circular/polygon) + entry/exit alert generation
- [ ] `[M]` Offline-timeout detection and rule-based last-known-position fallback
- [ ] `[M]` 30-day route-history replay

### Trip logging
- [ ] `[H]` Trip creation/assignment endpoint (origin, destination, driver, vehicle)
- [ ] `[H]` Trip status flow: assigned → in_progress → completed
- [ ] `[M]` Trip history search/filter by vehicle, driver, date range
- [ ] `[M]` Duration-overrun flagging for Dispatcher review

### Maintenance & fuel
- [ ] `[H]` Maintenance schedule definition (mileage/time/engine-hour based)
- [ ] `[H]` Automatic maintenance-due alert generation
- [ ] `[M]` Service-record logging (cost, notes)
- [ ] `[M]` Fuel-purchase logging + efficiency calculation
- [ ] `[L]` Fuel-efficiency anomaly flagging

### Driver safety
- [ ] `[M]` Harsh-braking / rapid-acceleration / speeding event detection
- [ ] `[M]` Rolling per-driver safety score calculation
- [ ] `[M]` Low-safety-score alert to Fleet Manager
- [ ] `[L]` GPS-fallback confidence tagging to avoid unfairly penalizing scores

### Notifications & reporting
- [ ] `[M]` Notification dispatch (in-app, email, SMS) per user preference
- [ ] `[M]` Exportable reports (CSV/PDF): utilization, maintenance cost, fuel cost, driver performance
- [ ] `[M]` Organization-level analytics dashboard

### Frontend / Website
- [ ] `[H]` Org admin panel: subscription/billing settings, user management
- [ ] `[H]` Fleet manager dashboard: vehicle/driver management, maintenance panel
- [ ] `[H]` Dispatcher dashboard: trip assignment, live map, agent-free manual routing
- [ ] `[M]` Reports view with export controls
- [ ] `[L]` Mobile-responsive breakpoint pass for dashboard panels

### Mobile (if required by course scope)
- [ ] `[M]` Driver app: Login, assigned trips list, trip status controls
- [ ] `[M]` Driver app: navigation link-out, notification handling
- [ ] `[L]` Push notifications (Firebase Cloud Messaging)

### Test data
- [ ] `[H]` Generate synthetic demo fleet dataset via `scripts/mock_fleet_generator.py` (vehicles, drivers, GPS traces)
- [ ] `[M]` Seed a demo organization with sample trips, maintenance records, and fuel logs for end-to-end testing

### QA / Documentation
- [ ] `[M]` End-to-end test pass covering onboarding through trip completion, extended to new modules
- [ ] `[M]` Update SRS to v0.2/v1.0 after Week 2 design review
- [ ] `[L]` Record demo video / prepare defense walkthrough

---

## How to use this file

1. When starting a task, create a matching GitHub Issue, assign an owner, add labels (`backend`, `frontend`, `tracking`, `week-N`, etc.).
2. Reference the issue number in your PR (`Closes #N`).
3. Check the box here once merged to `dev`.
4. Re-prioritize freely — this is a living backlog, not a fixed contract.
