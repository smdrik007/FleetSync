# Database Schema Design

This document details the expanded PostgreSQL database schema for FleetSync, upgraded from the initial prototype to a robust, real-world model suitable for a multi-tenant SaaS platform.

## 1. Assumptions and Business Rules
* **Multi-Tenancy:** The system strictly partitions data by `institution_id`. Every core entity is owned by an institution, ensuring isolation.
* **UUID Primary Keys:** All tables use UUIDs (version 4) for primary keys to prevent enumeration attacks and support distributed data generation.
* **Route Reusability:** A `Route` consists of multiple `Stops`. `Stops` are reusable physical locations across different routes (e.g. a central bus depot). The many-to-many relationship is resolved by `route_stops`.
* **Telemetry History:** Instead of overwriting a vehicle's `lastLatitude`/`lastLongitude`, the system logs a stream of telemetry data in `gps_logs` tied to a specific `Trip`.
* **SaaS Billing:** The `subscriptions` table tracks SaaS tier billing. An institution has a subscription plan (e.g. Basic, Pro, Enterprise).

---

## 2. Relationships Summary Table

| Source Entity | Target Entity | Relationship | Foreign Key Location | ON DELETE Behavior |
| --- | --- | --- | --- | --- |
| `institutions` | `subscriptions` | 1:N | `subscriptions.institution_id` | CASCADE |
| `institutions` | `users` | 1:N | `users.institution_id` | CASCADE |
| `institutions` | `vehicles` | 1:N | `vehicles.institution_id` | CASCADE |
| `institutions` | `routes` | 1:N | `routes.institution_id` | CASCADE |
| `institutions` | `stops` | 1:N | `stops.institution_id` | CASCADE |
| `vehicle_models` | `vehicles` | 1:N | `vehicles.model_id` | RESTRICT |
| `users` (driver) | `vehicles` | 1:1 / 1:N | `vehicles.assigned_driver_id` | SET NULL |
| `routes` | `vehicles` | 1:N | `vehicles.assigned_route_id` | SET NULL |
| `routes` | `route_stops` | 1:N | `route_stops.route_id` | CASCADE |
| `stops` | `route_stops` | 1:N | `route_stops.stop_id` | CASCADE |
| `vehicles` | `trips` | 1:N | `trips.vehicle_id` | CASCADE |
| `users` (driver) | `trips` | 1:N | `trips.driver_id` | RESTRICT |
| `routes` | `trips` | 1:N | `trips.route_id` | SET NULL |
| `trips` | `gps_logs` | 1:N | `gps_logs.trip_id` | CASCADE |
| `vehicles` | `gps_logs` | 1:N | `gps_logs.vehicle_id` | CASCADE |
| `vehicles` | `maintenance_records`| 1:N | `maintenance_records.vehicle_id` | CASCADE |
| `vehicles` | `fuel_logs` | 1:N | `fuel_logs.vehicle_id` | CASCADE |
| `users` | `fuel_logs` | 1:N | `fuel_logs.logged_by_user_id`| SET NULL |
| `users` | `notifications` | 1:N | `notifications.user_id` | CASCADE |

---

## 3. SQL Data Definition Language (DDL)

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Type Definitions (Enums)
CREATE TYPE user_role AS ENUM ('AUTHORITY', 'DRIVER', 'PASSENGER', 'ADMIN');
CREATE TYPE vehicle_status AS ENUM ('ACTIVE', 'ON_TRIP', 'MAINTENANCE', 'INACTIVE');
CREATE TYPE trip_status AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE maintenance_status AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- 1. institutions
CREATE TABLE institutions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    logo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. subscriptions
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    plan_name VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    start_date DATE NOT NULL,
    end_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    role user_role NOT NULL DEFAULT 'PASSENGER',
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (institution_id, email)
);

-- 4. vehicle_models
CREATE TABLE vehicle_models (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    make VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    year INT CHECK (year >= 1900),
    fuel_type VARCHAR(50),
    capacity INT CHECK (capacity > 0)
);

-- 5. routes
CREATE TABLE routes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. vehicles
CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    model_id UUID NOT NULL REFERENCES vehicle_models(id) ON DELETE RESTRICT,
    assigned_driver_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    assigned_route_id UUID REFERENCES routes(id) ON DELETE SET NULL,
    vehicle_number VARCHAR(50) NOT NULL,
    plate_number VARCHAR(50) NOT NULL,
    current_status vehicle_status DEFAULT 'INACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (institution_id, plate_number),
    UNIQUE (institution_id, vehicle_number)
);

-- 7. stops
CREATE TABLE stops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    latitude DECIMAL(9, 6) NOT NULL,
    longitude DECIMAL(10, 6) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. route_stops (Junction Table)
CREATE TABLE route_stops (
    route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    stop_id UUID NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
    stop_order INT NOT NULL CHECK (stop_order > 0),
    PRIMARY KEY (route_id, stop_id),
    UNIQUE (route_id, stop_order)
);

-- 9. trips
CREATE TABLE trips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    route_id UUID REFERENCES routes(id) ON DELETE SET NULL,
    status trip_status DEFAULT 'IN_PROGRESS',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP WITH TIME ZONE,
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- 10. gps_logs
CREATE TABLE gps_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    latitude DECIMAL(9, 6) NOT NULL,
    longitude DECIMAL(10, 6) NOT NULL,
    accuracy DECIMAL(8, 2),
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. maintenance_records
CREATE TABLE maintenance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    cost DECIMAL(10, 2) NOT NULL CHECK (cost >= 0),
    service_date DATE NOT NULL,
    status maintenance_status DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 12. fuel_logs
CREATE TABLE fuel_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    logged_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    volume DECIMAL(8, 2) NOT NULL CHECK (volume > 0),
    total_cost DECIMAL(10, 2) NOT NULL CHECK (total_cost >= 0),
    log_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 13. notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_users_institution ON users(institution_id);
CREATE INDEX idx_vehicles_institution ON vehicles(institution_id);
CREATE INDEX idx_trips_vehicle ON trips(vehicle_id);
CREATE INDEX idx_gps_logs_trip ON gps_logs(trip_id);
CREATE INDEX idx_route_stops_route ON route_stops(route_id);
CREATE INDEX idx_notifications_user ON notifications(user_id);
```

---

## 4. Normalization Justification

The design meticulously follows standard database normalization rules to ensure data integrity and avoid redundancy:

* **1NF (First Normal Form):** Every table has a primary key (`id` UUID or a composite PK like in `route_stops`). All attributes contain atomic values (no comma-separated lists). For example, a route's multiple stops are split into the `route_stops` table rather than being an array field on the `routes` table.
* **2NF (Second Normal Form):** The database satisfies 2NF because it is in 1NF and all non-key attributes are strictly dependent on the primary key. In the `route_stops` composite key table, `stop_order` depends on both `route_id` and `stop_id`.
* **3NF (Third Normal Form):** The database satisfies 3NF because there are no transitive functional dependencies. For instance, `vehicle_models` is abstracted out of `vehicles`. Rather than storing `make`, `model`, and `capacity` on every vehicle (which could lead to anomalies if a model's capacity is updated), we reference a `model_id`.

**Deliberate Denormalization / Optimizations:**
We maintain `vehicle_id` on the `gps_logs` table, even though `vehicle_id` could be derived by joining through `trips`. This is a deliberate read-optimization. When rendering a map of all currently active vehicles regardless of their trip, querying `gps_logs` filtered directly by `vehicle_id` is drastically faster than joining through `trips` in high-throughput telemetry environments.
