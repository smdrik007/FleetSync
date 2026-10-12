-- =============================================================================
-- FleetSync Database Schema  (v2.0, multi-tenant SaaS)
-- Target: PostgreSQL 15+ with PostGIS
--
-- Tenant isolation model
--   1. Every tenant-owned table carries institution_id.
--   2. Core tables expose UNIQUE (institution_id, id); child tables reference
--      them with composite FKs (institution_id, x_id), so a row can never point
--      at another tenant's row.
--   3. Row Level Security filters by current_setting('app.current_institution_id').
--
-- Sections
--   0. Extensions and helper functions
--   1. Tenancy, users and access
--   2. Fleet and assignments
--   3. Tracking and trips
--   4. Maintenance, fuel and notifications
--   5. Triggers (updated_at, vehicle model scope, latest position)
--   6. Row Level Security
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Extensions and helpers
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive emails

-- Returns the tenant for the current connection (NULL if not set, so RLS
-- shows nothing rather than everything).
CREATE OR REPLACE FUNCTION current_institution_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_institution_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END
$$;

-- =============================================================================
-- 1. TENANCY, USERS AND ACCESS
-- =============================================================================

CREATE TABLE institutions (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    slug        text        NOT NULL UNIQUE
                            CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    logo_url    text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id  uuid        NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    plan_name       text        NOT NULL,
    status          text        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('trial', 'active', 'past_due', 'cancelled', 'expired')),
    start_date      date        NOT NULL DEFAULT current_date,
    end_date        date,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX idx_subscriptions_institution ON subscriptions (institution_id);

-- Platform-level staff. Not tenant-scoped.
CREATE TABLE platform_admins (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name           text        NOT NULL,
    email          citext      NOT NULL UNIQUE,
    password_hash  text        NOT NULL,
    admin_level    text        NOT NULL DEFAULT 'support'
                               CHECK (admin_level IN ('support', 'admin', 'super_admin')),
    is_active      boolean     NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Login identities. Email is globally unique so login can resolve the tenant.
CREATE TABLE users (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id  uuid        NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    name            text        NOT NULL,
    email           citext      NOT NULL UNIQUE,
    phone           text,
    password_hash   text        NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_users_tenant UNIQUE (institution_id, id)
);

-- Employee records. May optionally link to a login user.
CREATE TABLE drivers (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id     uuid        NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    user_id            uuid        UNIQUE,
    employee_code      text,
    name               text        NOT NULL,
    phone              text,
    license_number     text        NOT NULL,
    license_class      text,
    license_expiry     date,
    employment_status  text        NOT NULL DEFAULT 'active'
                                   CHECK (employment_status IN ('active', 'on_leave', 'suspended', 'terminated')),
    hired_at           date,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_drivers_tenant          UNIQUE (institution_id, id),
    CONSTRAINT uq_drivers_license         UNIQUE (institution_id, license_number),
    CONSTRAINT fk_drivers_user            FOREIGN KEY (institution_id, user_id)
        REFERENCES users (institution_id, id) ON DELETE SET NULL (user_id)
);

CREATE TABLE roles (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id  uuid        NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    name            text        NOT NULL,
    description     text,
    is_system       boolean     NOT NULL DEFAULT false,   -- seeded roles that tenants cannot delete
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_roles_tenant UNIQUE (institution_id, id),
    CONSTRAINT uq_roles_name   UNIQUE (institution_id, name)
);

-- Global permission catalog (shared by all tenants).
CREATE TABLE permissions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code         text NOT NULL UNIQUE,      -- e.g. 'vehicles.read', 'trips.manage'
    description  text
);

CREATE TABLE user_roles (
    user_id         uuid        NOT NULL,
    role_id         uuid        NOT NULL,
    institution_id  uuid        NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    assigned_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id),
    CONSTRAINT fk_user_roles_user FOREIGN KEY (institution_id, user_id)
        REFERENCES users (institution_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_role FOREIGN KEY (institution_id, role_id)
        REFERENCES roles (institution_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_user_roles_role ON user_roles (role_id);

CREATE TABLE role_permissions (
    role_id        uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
    permission_id  uuid NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX idx_role_permissions_permission ON role_permissions (permission_id);

-- =============================================================================
-- 2. FLEET AND ASSIGNMENTS
-- =============================================================================

-- institution_id IS NULL  ->  global platform catalog entry.
CREATE TABLE vehicle_models (
    id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id  uuid    REFERENCES institutions (id) ON DELETE CASCADE,
    make            text    NOT NULL,
    model           text    NOT NULL,
    year            integer CHECK (year BETWEEN 1900 AND 2100),
    fuel_type       text,
    capacity        integer CHECK (capacity IS NULL OR capacity > 0)
);
CREATE INDEX idx_vehicle_models_institution ON vehicle_models (institution_id);

CREATE TABLE routes (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id  uuid        NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    name            text        NOT NULL,
    description     text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_routes_tenant UNIQUE (institution_id, id),
    CONSTRAINT uq_routes_name   UNIQUE (institution_id, name)
);

CREATE TABLE stops (
    id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id  uuid             NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    name            text             NOT NULL,
    latitude        double precision NOT NULL CHECK (latitude  BETWEEN  -90 AND  90),
    longitude       double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    created_at      timestamptz      NOT NULL DEFAULT now(),
    CONSTRAINT uq_stops_tenant UNIQUE (institution_id, id)
);

CREATE TABLE route_stops (
    route_id        uuid    NOT NULL,
    stop_id         uuid    NOT NULL,
    institution_id  uuid    NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    stop_order      integer NOT NULL CHECK (stop_order > 0),
    PRIMARY KEY (route_id, stop_id),
    -- Deferred so stops can be re-ordered inside one transaction.
    CONSTRAINT uq_route_stops_order UNIQUE (route_id, stop_order) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT fk_route_stops_route FOREIGN KEY (institution_id, route_id)
        REFERENCES routes (institution_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_route_stops_stop  FOREIGN KEY (institution_id, stop_id)
        REFERENCES stops (institution_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_route_stops_stop ON route_stops (stop_id);

-- Driver and route assignment is optional (ride-hailing / on-demand workflows).
CREATE TABLE vehicles (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id      uuid        NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    model_id            uuid        NOT NULL REFERENCES vehicle_models (id),
    assigned_driver_id  uuid,
    assigned_route_id   uuid,
    vehicle_number      text        NOT NULL,
    plate_number        text        NOT NULL,
    current_status      text        NOT NULL DEFAULT 'idle'
                                    CHECK (current_status IN ('idle', 'on_trip', 'maintenance', 'offline', 'retired')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_vehicles_tenant  UNIQUE (institution_id, id),
    CONSTRAINT uq_vehicles_number  UNIQUE (institution_id, vehicle_number),
    CONSTRAINT uq_vehicles_plate   UNIQUE (institution_id, plate_number),
    CONSTRAINT fk_vehicles_driver  FOREIGN KEY (institution_id, assigned_driver_id)
        REFERENCES drivers (institution_id, id) ON DELETE SET NULL (assigned_driver_id),
    CONSTRAINT fk_vehicles_route   FOREIGN KEY (institution_id, assigned_route_id)
        REFERENCES routes (institution_id, id) ON DELETE SET NULL (assigned_route_id)
);
CREATE INDEX idx_vehicles_model  ON vehicles (model_id);
CREATE INDEX idx_vehicles_driver ON vehicles (assigned_driver_id) WHERE assigned_driver_id IS NOT NULL;
CREATE INDEX idx_vehicles_route  ON vehicles (assigned_route_id)  WHERE assigned_route_id  IS NOT NULL;

-- =============================================================================
-- 3. TRACKING AND TRIPS
-- =============================================================================

CREATE TABLE devices (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id    uuid        NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    vehicle_id        uuid        NOT NULL,
    device_type       text        NOT NULL,
    imei              text        NOT NULL UNIQUE,    -- physical identifier, globally unique
    sim_iccid         text,
    firmware_version  text,
    status            text        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'inactive', 'faulty', 'retired')),
    installed_at      timestamptz,
    last_seen_at      timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_devices_tenant UNIQUE (institution_id, id),
    CONSTRAINT fk_devices_vehicle FOREIGN KEY (institution_id, vehicle_id)
        REFERENCES vehicles (institution_id, id)
);
CREATE INDEX idx_devices_vehicle ON devices (vehicle_id);

CREATE TABLE trips (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id  uuid        NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    vehicle_id      uuid        NOT NULL,
    driver_id       uuid        NOT NULL,
    route_id        uuid,                                   -- NULL for on-demand trips
    status          text        NOT NULL DEFAULT 'in_progress'
                                CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    started_at      timestamptz NOT NULL DEFAULT now(),
    ended_at        timestamptz,
    CONSTRAINT uq_trips_tenant UNIQUE (institution_id, id),
    CONSTRAINT chk_trips_times CHECK (ended_at IS NULL OR ended_at >= started_at),
    CONSTRAINT fk_trips_vehicle FOREIGN KEY (institution_id, vehicle_id)
        REFERENCES vehicles (institution_id, id),
    CONSTRAINT fk_trips_driver  FOREIGN KEY (institution_id, driver_id)
        REFERENCES drivers (institution_id, id),
    CONSTRAINT fk_trips_route   FOREIGN KEY (institution_id, route_id)
        REFERENCES routes (institution_id, id) ON DELETE SET NULL (route_id)
);
CREATE INDEX idx_trips_vehicle_started ON trips (vehicle_id, started_at DESC);
CREATE INDEX idx_trips_driver_started  ON trips (driver_id,  started_at DESC);
CREATE INDEX idx_trips_route           ON trips (route_id) WHERE route_id IS NOT NULL;
-- At most one open trip per vehicle.
CREATE UNIQUE INDEX uq_trips_one_active_per_vehicle ON trips (vehicle_id) WHERE status = 'in_progress';

-- Raw telemetry, partitioned by month on recorded_at.
-- NOTE: the primary key must include the partition key.
CREATE TABLE gps_logs (
    id              bigint           GENERATED ALWAYS AS IDENTITY,
    recorded_at     timestamptz      NOT NULL,
    institution_id  uuid             NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    vehicle_id      uuid             NOT NULL,
    device_id       uuid             NOT NULL,
    trip_id         uuid,                                   -- NULL when the vehicle moves outside a trip
    location        geography(Point, 4326) NOT NULL,
    accuracy        double precision CHECK (accuracy IS NULL OR accuracy >= 0),
    speed           double precision CHECK (speed    IS NULL OR speed    >= 0),   -- km/h
    heading         double precision CHECK (heading  IS NULL OR heading >= 0 AND heading < 360),
    ignition_on     boolean,
    received_at     timestamptz      NOT NULL DEFAULT now(),
    PRIMARY KEY (id, recorded_at),
    CONSTRAINT fk_gps_logs_vehicle FOREIGN KEY (institution_id, vehicle_id)
        REFERENCES vehicles (institution_id, id),
    CONSTRAINT fk_gps_logs_device  FOREIGN KEY (institution_id, device_id)
        REFERENCES devices (institution_id, id),
    CONSTRAINT fk_gps_logs_trip    FOREIGN KEY (institution_id, trip_id)
        REFERENCES trips (institution_id, id)
) PARTITION BY RANGE (recorded_at);

-- Indexes on the parent are created automatically on every partition.
CREATE INDEX idx_gps_logs_vehicle_time ON gps_logs (vehicle_id, recorded_at DESC);
CREATE INDEX idx_gps_logs_trip_time    ON gps_logs (trip_id, recorded_at) WHERE trip_id IS NOT NULL;

-- Creates the monthly partition that contains p_month (e.g. gps_logs_2026_10).
-- Run ahead of time from a scheduler (pg_cron, pg_partman, or an app job).
-- Retention is a plain DROP TABLE gps_logs_YYYY_MM (or DETACH + archive).
CREATE OR REPLACE FUNCTION create_gps_logs_partition(p_month date) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    v_start date := date_trunc('month', p_month)::date;
    v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
    v_name  text := format('gps_logs_%s', to_char(v_start, 'YYYY_MM'));
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF gps_logs FOR VALUES FROM (%L) TO (%L)',
        v_name, v_start, v_end);
    RETURN v_name;
END
$$;

-- Bootstrap: current month and the next two.
SELECT create_gps_logs_partition(date '2026-10-01');
SELECT create_gps_logs_partition(date '2026-11-01');
SELECT create_gps_logs_partition(date '2026-12-01');

-- Live map state: exactly one row per vehicle, upserted on every ping.
CREATE TABLE vehicle_latest_position (
    vehicle_id      uuid        PRIMARY KEY,
    institution_id  uuid        NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    device_id       uuid        NOT NULL,
    trip_id         uuid,
    location        geography(Point, 4326) NOT NULL,
    speed           double precision,
    heading         double precision,
    ignition_on     boolean,
    recorded_at     timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_vlp_vehicle FOREIGN KEY (institution_id, vehicle_id)
        REFERENCES vehicles (institution_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_vlp_device  FOREIGN KEY (institution_id, device_id)
        REFERENCES devices (institution_id, id),
    CONSTRAINT fk_vlp_trip    FOREIGN KEY (institution_id, trip_id)
        REFERENCES trips (institution_id, id) ON DELETE SET NULL (trip_id)
);
CREATE INDEX idx_vlp_institution ON vehicle_latest_position (institution_id);
CREATE INDEX idx_vlp_location    ON vehicle_latest_position USING gist (location);

-- =============================================================================
-- 4. MAINTENANCE, FUEL AND NOTIFICATIONS
-- =============================================================================

CREATE TABLE maintenance_records (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id  uuid          NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    vehicle_id      uuid          NOT NULL,
    description     text          NOT NULL,
    cost            numeric(12,2) CHECK (cost IS NULL OR cost >= 0),
    service_date    date          NOT NULL,
    status          text          NOT NULL DEFAULT 'scheduled'
                                  CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    created_at      timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT fk_maintenance_vehicle FOREIGN KEY (institution_id, vehicle_id)
        REFERENCES vehicles (institution_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_maintenance_vehicle_date ON maintenance_records (vehicle_id, service_date DESC);

CREATE TABLE fuel_logs (
    id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id      uuid          NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    vehicle_id          uuid          NOT NULL,
    logged_by_user_id   uuid          NOT NULL,
    volume              numeric(10,2) NOT NULL CHECK (volume > 0),
    total_cost          numeric(12,2) NOT NULL CHECK (total_cost >= 0),
    log_date            date          NOT NULL DEFAULT current_date,
    CONSTRAINT fk_fuel_vehicle FOREIGN KEY (institution_id, vehicle_id)
        REFERENCES vehicles (institution_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_fuel_user    FOREIGN KEY (institution_id, logged_by_user_id)
        REFERENCES users (institution_id, id)
);
CREATE INDEX idx_fuel_vehicle_date ON fuel_logs (vehicle_id, log_date DESC);
CREATE INDEX idx_fuel_user         ON fuel_logs (logged_by_user_id);

CREATE TABLE notifications (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id  uuid        NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    user_id         uuid        NOT NULL,
    title           text        NOT NULL,
    message         text        NOT NULL,
    is_read         boolean     NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_notifications_user FOREIGN KEY (institution_id, user_id)
        REFERENCES users (institution_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_notifications_user_unread ON notifications (user_id, created_at DESC) WHERE NOT is_read;

-- =============================================================================
-- 5. TRIGGERS
-- =============================================================================

-- 5a. Maintain updated_at.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'institutions', 'subscriptions', 'platform_admins', 'users', 'drivers',
        'roles', 'routes', 'vehicles', 'devices']
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
    END LOOP;
END
$$;

-- 5b. A vehicle may use a global model (institution_id IS NULL) or one that
--     belongs to its own tenant. A composite FK cannot express "or NULL".
CREATE OR REPLACE FUNCTION check_vehicle_model_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_model_tenant uuid;
BEGIN
    SELECT institution_id INTO v_model_tenant FROM vehicle_models WHERE id = NEW.model_id;
    IF v_model_tenant IS NOT NULL AND v_model_tenant <> NEW.institution_id THEN
        RAISE EXCEPTION 'vehicle_models % belongs to another institution', NEW.model_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER trg_vehicles_model_scope
    BEFORE INSERT OR UPDATE OF model_id, institution_id ON vehicles
    FOR EACH ROW EXECUTE FUNCTION check_vehicle_model_scope();

-- 5c. Keep vehicle_latest_position current; ignore out-of-order pings.
--     If ingest throughput gets very high, move this upsert into the ingest
--     service and drop the trigger.
CREATE OR REPLACE FUNCTION upsert_vehicle_latest_position() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO vehicle_latest_position AS v
        (vehicle_id, institution_id, device_id, trip_id, location,
         speed, heading, ignition_on, recorded_at, updated_at)
    VALUES
        (NEW.vehicle_id, NEW.institution_id, NEW.device_id, NEW.trip_id, NEW.location,
         NEW.speed, NEW.heading, NEW.ignition_on, NEW.recorded_at, now())
    ON CONFLICT (vehicle_id) DO UPDATE SET
        device_id = EXCLUDED.device_id, trip_id = EXCLUDED.trip_id,
        location = EXCLUDED.location, speed = EXCLUDED.speed,
        heading = EXCLUDED.heading, ignition_on = EXCLUDED.ignition_on,
        recorded_at = EXCLUDED.recorded_at, updated_at = now()
    WHERE EXCLUDED.recorded_at > v.recorded_at;
    RETURN NULL;
END
$$;

CREATE TRIGGER trg_gps_logs_latest_position
    AFTER INSERT ON gps_logs
    FOR EACH ROW EXECUTE FUNCTION upsert_vehicle_latest_position();

-- =============================================================================
-- 6. ROW LEVEL SECURITY
-- The application connects as a non-owner role and runs, per request / tx:
--     SELECT set_config('app.current_institution_id', '<uuid>', true);
-- Table owners bypass RLS unless FORCE ROW LEVEL SECURITY is added.
-- Login (email lookup before the tenant is known) and platform_admins access
-- should go through a privileged role or SECURITY DEFINER function.
-- =============================================================================

-- Tables that own an institution_id column.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'subscriptions', 'users', 'drivers', 'roles', 'user_roles',
        'routes', 'stops', 'route_stops', 'vehicles', 'devices', 'trips',
        'gps_logs', 'vehicle_latest_position',
        'maintenance_records', 'fuel_logs', 'notifications']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I
                 USING (institution_id = current_institution_id())
                 WITH CHECK (institution_id = current_institution_id())', t);
    END LOOP;
END
$$;

-- A tenant sees only itself.
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON institutions
    USING (id = current_institution_id())
    WITH CHECK (id = current_institution_id());

-- Global catalog rows are readable by everyone; writes only to own rows.
ALTER TABLE vehicle_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicle_models_read ON vehicle_models FOR SELECT
    USING (institution_id IS NULL OR institution_id = current_institution_id());
CREATE POLICY vehicle_models_write ON vehicle_models FOR ALL
    USING (institution_id = current_institution_id())
    WITH CHECK (institution_id = current_institution_id());

-- role_permissions has no institution_id; visibility follows the (RLS-filtered) roles table.
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_permissions
    USING      (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id))
    WITH CHECK (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id));

COMMIT;
