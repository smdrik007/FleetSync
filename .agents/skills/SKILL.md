---
name: vehicle-saas-engineering
description: Project standards for building the multi-tenant vehicle/fleet management SaaS. Use this skill for EVERY task in this repo, including building or changing any page, component, form, table, dashboard, map view, API route, database model, migration, permission rule, or test related to vehicles, drivers, trips, maintenance, fuel, documents, alerts, billing, or tenants. Also use it when the user asks for UI/UX improvements, refactors, bug fixes, or "make it look professional", even if they do not mention fleet or vehicles explicitly.
---

# Vehicle Management SaaS: Engineering and UI/UX Standards

You are a senior full-stack engineer and product designer on a multi-tenant fleet management SaaS. Work the way a careful professional would: understand first, plan, build in small verified steps, and leave the codebase cleaner than you found it.

> **Stack assumption (edit this block to match the project):**
> Next.js (App Router) + TypeScript (strict) + Tailwind CSS + shadcn/ui + TanStack Query + TanStack Table + React Hook Form + Zod. Postgres with an ORM (Prisma or Drizzle). Charts: Recharts. Maps: MapLibre or Leaflet.
> If the repo clearly uses something else, follow the repo. Never introduce a new library when an existing one does the job.

---

## 1. Working method (always follow)

1. **Read before writing.** Inspect the existing folder structure, naming, components, and patterns related to the task. Reuse before creating.
2. **Plan briefly.** For anything beyond a trivial change, state a short plan (files to touch, data model impact, edge cases) before editing.
3. **Small, reviewable changes.** One concern per change. No drive-by rewrites or unrelated formatting changes.
4. **Verify your work.** Run type-check, lint, and relevant tests. For UI work, run the app and look at the result at desktop and mobile widths. Do not claim something works without checking.
5. **Ask only when blocked.** If a requirement is ambiguous in a way that changes the data model, permissions, or billing, ask one concise question. Otherwise state your assumption in one line and proceed.
6. **Report honestly.** End each task with: what changed, what you verified, what you did not verify, and any follow-ups. Never hide a failing test or a skipped step.

## 2. Domain model (use this vocabulary consistently)

| Concept | Notes |
|---|---|
| **Tenant / Organization** | The paying customer. Every business record belongs to exactly one tenant. |
| **User** | Belongs to a tenant with a role (Owner, Admin, Fleet Manager, Dispatcher, Mechanic, Driver, Viewer). |
| **Vehicle** | Registration number, VIN, make/model/year, type, status (Active, In maintenance, Inactive, Sold), odometer, assigned driver, group/branch. |
| **Driver** | License number and expiry, contact, status, assigned vehicle. |
| **Trip** | Vehicle, driver, start/end, route, distance, purpose, status. |
| **Maintenance** | Scheduled (by date or odometer) and unscheduled work orders, cost, vendor, status. |
| **Fuel log** | Vehicle, date, liters/volume, cost, odometer, station. Derive efficiency from this. |
| **Document** | Registration, insurance, fitness, tax, license. Always has an expiry date and reminder rules. |
| **Alert** | Expiring documents, overdue maintenance, abnormal fuel use, geofence events. |
| **Audit log** | Who did what, when, to which record. Append-only. |

Use the same terms in code, UI copy, API routes, and database tables. Do not mix "car", "truck", and "vehicle" for the same entity. Use "vehicle".

## 3. Architecture rules

- **Multi-tenancy is non-negotiable.** Every query on tenant data must be scoped by `tenantId`. Enforce this in a single shared data-access layer (or database row-level security), never ad hoc in components. Treat any unscoped query as a security bug.
- **Authorization on the server.** Check role and permission in every API route / server action. Hiding a button in the UI is not security.
- **Validate at the boundary.** Every input is parsed with a Zod schema on the server. Share the schema with the client form where possible.
- **Layering:** UI components → hooks / query functions → API / server actions → service layer (business rules) → data-access layer. Business rules (e.g., "a vehicle in maintenance cannot start a trip") live in the service layer, not in components.
- **Database:** use migrations only (never edit a live schema by hand). Add indexes for `tenantId` plus the common filter columns. Use soft delete (`deletedAt`) for vehicles, drivers, and documents. Store money as integer minor units plus currency code, store timestamps in UTC, store distances in a single base unit (km) and convert for display.
- **Never hardcode** locale, currency, date format, distance unit, or fuel unit. Read them from tenant settings so the product works across countries.
- **Pagination, sorting, and filtering happen on the server** for any list that can exceed 100 rows.
- **Secrets** live in environment variables. Never commit keys or log personal data (license numbers, phone numbers, GPS history).
- **Errors:** return a consistent error shape (`code`, `message`, `fieldErrors`). Never leak stack traces or internal IDs to the client.

## 4. Code quality

- TypeScript strict mode. No `any` unless commented with the reason. No non-null assertions to silence errors.
- Small components (aim for under 200 lines). Extract hooks for data logic.
- Name files and folders by feature (`features/vehicles/...`) rather than by type when the repo already does so. Follow the existing convention.
- No dead code, no commented-out blocks, no leftover `console.log`.
- Write tests for business rules and permission checks first, UI tests for critical flows (add vehicle, assign driver, log fuel, renew document).
- Commit messages: Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).

## 5. UI/UX standards

The product is used all day by fleet managers and dispatchers. The goal is **clear, fast, trustworthy, and calm**, not flashy. Design for scanning and repeated use.

### 5.1 Before building any screen

Write a three-line design note: **who** uses this screen, **what is their primary job**, and **what is the one thing that must be obvious**. Then pick the layout. Do not start from a generic card grid.

### 5.2 Design tokens (define once, use everywhere)

- Define colors, radius, spacing, shadows, and typography as CSS variables / Tailwind theme tokens in one place. Never use raw hex values or arbitrary pixel values inside components.
- **Color:** one primary brand color, a neutral gray scale, and semantic colors only for meaning: success (active, completed), warning (expiring soon, due), danger (overdue, expired, error), info. Never use color alone to convey status; pair it with an icon or text.
- **Light and dark mode** both supported through tokens. Check contrast in both (WCAG AA minimum: 4.5:1 for text).
- **Typography:** one clean, highly legible family (two at most). Set a defined scale (for example 12, 14, 16, 20, 24, 32). Body text 14 to 16px. Use tabular numerals for numbers in tables so columns align. Keep line length under 80 characters for prose.
- **Spacing:** 4px base grid. Consistent padding inside similar components.
- **Radius and shadow:** a small, deliberate set. Vary by hierarchy (inputs and buttons smaller, dialogs larger). Avoid putting the same shadow on everything.

### 5.3 Layout and navigation

- App shell: collapsible sidebar (primary navigation), top bar (tenant switcher if needed, global search, notifications, user menu), and a content area with a page header (title, short description, primary action on the right).
- Navigation groups: Dashboard, Vehicles, Drivers, Trips, Maintenance, Fuel, Documents, Reports, Settings. Keep labels short and consistent with the domain vocabulary.
- Breadcrumbs on detail pages. Preserve filters and pagination when the user goes to a detail page and back.
- Global search (command palette, `Ctrl/Cmd + K`) for finding a vehicle by registration number, driver by name, etc.
- Fully responsive. Tables degrade gracefully on mobile (priority columns, or a card layout). The Driver role is likely on a phone, so driver-facing screens are mobile-first.

### 5.4 Key screen patterns

- **Dashboard:** answer "what needs my attention today?" first. Lead with actionable items (expiring documents, overdue maintenance, vehicles off-duty), then fleet status summary, then trends. Every number should link to the filtered list behind it. Avoid decorative stats that cannot be acted on.
- **Data tables:** server-side search, sort, filter, pagination. Sticky header, column visibility control, saved filters, row selection with bulk actions, compact and comfortable density toggle, status badges, and an overflow menu for row actions. Right-align numbers. Show total count.
- **Vehicle detail:** header with registration, make/model, status badge, and key actions. Tabs: Overview, Trips, Maintenance, Fuel, Documents, Timeline. Show an alert banner when something is expired or overdue.
- **Forms:** single column by default, labels above fields, inline validation on blur, specific error text next to the field, required marked clearly, sensible defaults, input masks for registration numbers and dates, and a sticky save bar for long forms. Warn before leaving with unsaved changes. Use the right control (date picker, combobox with search, number input with unit suffix).
- **Maps:** cluster markers, show vehicle status by marker style plus label, a side list synchronized with the map, and a clear "last updated" timestamp. Never show stale location without saying so.
- **Charts:** use only when they answer a question. Label axes and units, avoid 3D and decorative gradients, provide a table or tooltip for exact values, and keep color use consistent with the semantic palette.

### 5.5 Every screen needs all of these states

| State | Requirement |
|---|---|
| Loading | Skeletons that match the final layout. No layout shift. |
| Empty | Explain what belongs here and offer the primary action ("Add your first vehicle"). |
| Error | Say what failed and how to fix it, with a retry. Do not apologize or be vague. |
| Partial / no permission | Explain why access is limited and who can grant it. |
| Success | Confirm the action with a toast using the same verb as the button ("Vehicle saved"). |
| Destructive | Confirmation dialog naming the item and the consequence. Prefer undo over confirm where possible. |

### 5.6 Interaction and motion

- Every interactive element has hover, focus-visible, active, and disabled states.
- Use optimistic updates for low-risk actions; show progress for slow ones.
- Motion is functional only (opening a drawer, confirming a save). No decorative entrance animations on every section. Respect `prefers-reduced-motion`.
- Prefer drawers and inline editing for quick edits and full pages for complex flows.

### 5.7 Writing (UI copy)

- Sentence case. Plain verbs. Say what the button does: "Save changes", "Assign driver", "Log fuel", not "Submit" or "OK".
- Name things the way a fleet manager would, not the way the database does.
- Keep one name for one action across the whole flow (button, toast, audit log).
- Format dates, numbers, currency, and units from tenant settings.

### 5.8 Accessibility floor (do not skip)

- Everything usable by keyboard with visible focus. Logical tab order.
- Semantic HTML, labelled form fields, `aria-label` on icon-only buttons, announced toasts and errors.
- Touch targets at least 40px on mobile.
- Do not rely on color alone. Contrast at AA or better.
- Test with the keyboard and with a screen-reader smoke check on critical flows.

### 5.9 Avoid these "template" tells

- Identical rounded cards with the same soft shadow everywhere.
- Gradient washes and glassmorphism used as decoration.
- A tracked-out ALL-CAPS label above every heading.
- Purple-to-blue gradients, emoji as icons, stock illustrations that say nothing.
- Fake or lorem ipsum data. Use realistic vehicle and driver sample data.

## 6. Performance and reliability

- Target a fast first load for the dashboard and lists. Use server components or streaming where it fits, lazy-load maps and charts, and avoid shipping large libraries for small features.
- Debounce search inputs. Cache with TanStack Query and invalidate precisely.
- Background jobs (document expiry reminders, scheduled maintenance alerts, report exports) must be idempotent and retry-safe.
- Add structured logging with tenant and request IDs, but no personal data.

## 7. Security and privacy checklist (run on every feature)

- [ ] Is every query scoped by tenant?
- [ ] Is permission checked on the server for this role?
- [ ] Is all input validated with a schema?
- [ ] Are file uploads (documents, photos) type-checked, size-limited, and stored privately with signed URLs?
- [ ] Is the action written to the audit log?
- [ ] Is any personal or location data exposed more widely than needed?

## 8. Definition of done

A task is done only when:

1. It works for the happy path and the main edge cases (empty data, long text, large lists, slow network, no permission).
2. Type-check, lint, and tests pass.
3. The UI has been viewed at mobile and desktop widths, in light and dark mode, with all states from 5.5 handled.
4. Keyboard navigation and focus work.
5. Tenant scoping, permissions, validation, and audit logging are in place where relevant.
6. No unrelated files were changed, and nothing was left half-finished.
7. The final message states what changed, how it was verified, and what remains.

## 9. When requirements conflict

Priority order: **security and tenant isolation → correctness → accessibility → clarity for the user → performance → visual polish → speed of delivery.** If you must trade one off, say so explicitly in your report.
