# FleetSync Database Schema Map

**Version 2.0 · Multi-Tenant SaaS Architecture**

Entity-Relationship models for the FleetSync platform, split into four logical views. The architecture enforces strict tenant isolation through composite keys and a shared `institution_id` on every tenant-owned table. Diagrams use Mermaid syntax and render natively on GitHub or in any Markdown viewer that supports Mermaid.

A single combined diagram is available in `fleetsync_er_full.mmd`.

**Legend:** `PK` primary key · `FK` foreign key · `UK` unique key

---

## View 1: Tenancy, Users and Access

Covers the core tenant entity, subscriptions, employee identities (users and drivers), and the Role-Based Access Control (RBAC) model.

```mermaid
erDiagram
    institutions ||--o{ subscriptions : "subscribes"
    institutions ||--o{ users : "employs / registers"
    institutions ||--o{ drivers : "employs"
    institutions ||--o{ roles : "defines"
    institutions ||--o{ user_roles : "scopes"

    users |o--o| drivers : "has driver profile"
    users ||--o{ user_roles : "is granted"
    roles ||--o{ user_roles : "assigned via"
    roles ||--o{ role_permissions : "grants"
    permissions ||--o{ role_permissions : "granted via"

    institutions {
        uuid id PK
        string name
        string slug UK
        string logo_url
        timestamptz created_at
        timestamptz updated_at
    }

    subscriptions {
        uuid id PK
        uuid institution_id FK
        string plan_name
        string status
        date start_date
        date end_date
        timestamptz created_at
        timestamptz updated_at
    }

    platform_admins {
        uuid id PK
        string name
        string email UK
        string password_hash
        string admin_level
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    users {
        uuid id PK "UNIQUE with institution_id"
        uuid institution_id FK
        string name
        string email UK
        string phone
        string password_hash
        timestamptz created_at
        timestamptz updated_at
    }

    drivers {
        uuid id PK "UNIQUE with institution_id"
        uuid institution_id FK
        uuid user_id FK, UK
        string employee_code
        string name
        string phone
        string license_number UK
        string license_class
        date license_expiry
        string employment_status
        date hired_at
        timestamptz created_at
        timestamptz updated_at
    }

    roles {
        uuid id PK "UNIQUE with institution_id"
        uuid institution_id FK
        string name UK
        string description
        boolean is_system
        timestamptz created_at
        timestamptz updated_at
    }

    user_roles {
        uuid user_id PK, FK
        uuid role_id PK, FK
        uuid institution_id FK
        timestamptz assigned_at
    }

    permissions {
        uuid id PK
        string code UK
        string description
    }

    role_permissions {
        uuid role_id PK, FK
        uuid permission_id PK, FK
    }
```

> `platform_admins` is platform-level and not tenant-scoped, so it has no relationship to `institutions`.

---

## View 2: Fleet and Assignments

Manages the physical assets, grouping into global or tenant-specific models, and spatial routing definitions.

```mermaid
erDiagram
    institutions |o--o{ vehicle_models : "adds custom"
    institutions ||--o{ vehicles : "owns"
    institutions ||--o{ drivers : "employs"
    institutions ||--o{ routes : "manages"
    institutions ||--o{ stops : "defines"
    institutions ||--o{ route_stops : "scopes"

    vehicle_models ||--o{ vehicles : "classifies"
    drivers |o--o{ vehicles : "is assigned to"
    routes |o--o{ vehicles : "is assigned to"
    routes ||--o{ route_stops : "contains"
    stops ||--o{ route_stops : "appears in"

    institutions {
        uuid id PK
    }

    drivers {
        uuid id PK
        uuid institution_id FK
        string name
    }

    vehicle_models {
        uuid id PK
        uuid institution_id FK "nullable, NULL = global catalog"
        string make
        string model
        int year
        string fuel_type
        int capacity
    }

    vehicles {
        uuid id PK "UNIQUE with institution_id"
        uuid institution_id FK
        uuid model_id FK
        uuid assigned_driver_id FK "nullable"
        uuid assigned_route_id FK "nullable"
        string vehicle_number UK
        string plate_number UK
        string current_status
        timestamptz created_at
        timestamptz updated_at
    }

    routes {
        uuid id PK "UNIQUE with institution_id"
        uuid institution_id FK
        string name UK
        string description
        timestamptz created_at
        timestamptz updated_at
    }

    stops {
        uuid id PK "UNIQUE with institution_id"
        uuid institution_id FK
        string name
        float latitude
        float longitude
        timestamptz created_at
    }

    route_stops {
        uuid route_id PK, FK
        uuid stop_id PK, FK
        uuid institution_id FK
        int stop_order UK
    }
```

### Assignment and Model Rules

- `assigned_driver_id` and `assigned_route_id` on `vehicles` are strictly optional. This accommodates dynamic operational workflows such as ride-hailing or on-demand delivery, where a fixed route assignment does not apply.
- `vehicle_models` can act as a global platform catalog (rows where `institution_id IS NULL`). Because of this, safe references to it rely on check functions or triggers rather than purely composite foreign keys.

---

## View 3: Tracking and Trips

The real-time telemetry pipeline: physical devices mapped to vehicles, coordinate trails, and current map state.

```mermaid
erDiagram
    institutions ||--o{ devices : "owns"
    institutions ||--o{ trips : "runs"
    institutions ||--o{ gps_logs : "owns"
    institutions ||--o{ vehicle_latest_position : "owns"

    vehicles ||--o{ devices : "carries"
    vehicles ||--o{ trips : "performs"
    drivers ||--o{ trips : "drives"
    routes |o--o{ trips : "is followed by"

    trips |o--o{ gps_logs : "records"
    vehicles ||--o{ gps_logs : "emits"
    devices ||--o{ gps_logs : "reports"

    vehicles ||--o| vehicle_latest_position : "has live state"
    devices ||--o{ vehicle_latest_position : "last reported by"
    trips |o--o{ vehicle_latest_position : "current trip"

    institutions {
        uuid id PK
    }

    routes {
        uuid id PK
        uuid institution_id FK
    }

    drivers {
        uuid id PK
        uuid institution_id FK
    }

    vehicles {
        uuid id PK
        uuid institution_id FK
    }

    devices {
        uuid id PK "UNIQUE with institution_id"
        uuid institution_id FK
        uuid vehicle_id FK
        string device_type
        string imei UK
        string sim_iccid
        string firmware_version
        string status
        timestamptz installed_at
        timestamptz last_seen_at
        timestamptz created_at
        timestamptz updated_at
    }

    trips {
        uuid id PK "UNIQUE with institution_id"
        uuid institution_id FK
        uuid vehicle_id FK
        uuid driver_id FK
        uuid route_id FK "nullable"
        string status
        timestamptz started_at
        timestamptz ended_at
    }

    gps_logs {
        bigint id PK "identity column"
        timestamptz recorded_at PK "partition key"
        uuid institution_id FK
        uuid vehicle_id FK
        uuid device_id FK
        uuid trip_id FK "nullable"
        geography location
        float accuracy
        float speed
        float heading
        boolean ignition_on
        timestamptz received_at
    }

    vehicle_latest_position {
        uuid vehicle_id PK, FK
        uuid institution_id FK
        uuid device_id FK
        uuid trip_id FK "nullable"
        geography location
        float speed
        float heading
        boolean ignition_on
        timestamptz recorded_at
        timestamptz updated_at
    }
```

### GPS Log Volume Strategy

Telemetry grows much faster than core business entities, so `gps_logs` uses a dedicated volume-management approach:

```sql
CREATE TABLE gps_logs (
    id bigint GENERATED ALWAYS AS IDENTITY,
    recorded_at timestamptz NOT NULL,
    institution_id uuid NOT NULL,
    vehicle_id uuid NOT NULL,
    ...
    PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);
```

The time-series partitioning lets older chunks (e.g. `gps_logs_2026_10`) be dropped or rolled up efficiently once retention thresholds have passed. The live state is upserted into `vehicle_latest_position`, which keeps live-map queries off the raw log.

---

## View 4: Maintenance, Fuel and Notifications

Operational records for recurring tasks, expenditures, and communication with system users.

```mermaid
erDiagram
    institutions ||--o{ maintenance_records : "owns"
    institutions ||--o{ fuel_logs : "owns"
    institutions ||--o{ notifications : "owns"

    vehicles ||--o{ maintenance_records : "serviced in"
    vehicles ||--o{ fuel_logs : "refueled in"
    users ||--o{ fuel_logs : "logs"
    users ||--o{ notifications : "receives"

    institutions {
        uuid id PK
    }

    vehicles {
        uuid id PK
        uuid institution_id FK
    }

    users {
        uuid id PK
        uuid institution_id FK
    }

    maintenance_records {
        uuid id PK
        uuid institution_id FK
        uuid vehicle_id FK
        string description
        numeric cost
        date service_date
        string status
        timestamptz created_at
    }

    fuel_logs {
        uuid id PK
        uuid institution_id FK
        uuid vehicle_id FK
        uuid logged_by_user_id FK
        numeric volume
        numeric total_cost
        date log_date
    }

    notifications {
        uuid id PK
        uuid institution_id FK
        uuid user_id FK
        string title
        string message
        boolean is_read
        timestamptz created_at
    }
```

---

## Tenant Isolation Implementation

The schema relies on PostgreSQL-level constraints to prevent data bleeding between tenants. Core entities expose a composite unique key `UNIQUE (institution_id, id)`, so child tables are locked into the same institutional namespace when foreign keys are created.

```sql
ALTER TABLE vehicles ADD CONSTRAINT uq_vehicles_tenant UNIQUE (institution_id, id);

-- Composite FK ensures the referenced vehicle belongs to the same tenant
ALTER TABLE trips ADD CONSTRAINT fk_trips_vehicle
    FOREIGN KEY (institution_id, vehicle_id) REFERENCES vehicles (institution_id, id);
```

Application logic should be paired with connection-level Row Level Security (RLS) configured via `current_setting('app.current_institution_id')`, so tenant boundaries are enforced before queries execute.

---

## Modeling Notes

The source PDF lists keys and column names but not data types or nullability for most columns. The following were inferred when drawing these diagrams:

| Item | Assumption |
|---|---|
| Data types | `uuid` for ids, `timestamptz` for timestamps, `numeric` for money and volume, `boolean` for `is_*` and `ignition_on` flags |
| `gps_logs.location`, `vehicle_latest_position.location` | Drawn as `geography` (PostGIS). The PDF only says `location`. |
| `users` to `drivers` | Optional on both sides, so a driver need not have a login and a user need not be a driver. The PDF marks `drivers.user_id` as FK/UK without stating nullability. |
| Optional FKs | Only `assigned_driver_id`, `assigned_route_id` and `vehicle_models.institution_id` are explicit in the PDF. `trips.route_id`, `gps_logs.trip_id` and `vehicle_latest_position.trip_id` are marked nullable because trips may be route-less and vehicles can move outside trips. |
| Uniqueness scope | `email`, `license_number`, `vehicle_number`, `plate_number`, `imei`, `roles.name` and similar are shown as `UK` as in the PDF. Whether each is globally unique or unique per tenant should be confirmed in the DDL. |
| `UNIQUE with institution_id` | Shown on tables referenced by composite FKs (`users`, `drivers`, `roles`, `vehicles`, `routes`, `stops`, `devices`, `trips`). The PDF only shows this explicitly for `vehicles`. |
