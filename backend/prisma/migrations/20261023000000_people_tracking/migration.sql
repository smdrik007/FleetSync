-- People tracking: tracked people/equipment (assets), guardians, safe zones, and devices that report for them.
-- Vehicle tables are untouched; assets have their own latest-position table. Idempotent like the previous migration.

CREATE TABLE IF NOT EXISTS "assets" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'person',          -- person | equipment
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "consent_at" TIMESTAMP(3),
    "consent_by" TEXT,
    "tracking_paused" BOOLEAN NOT NULL DEFAULT false,
    "retention_days" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assets_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "assets_institution_id_id_key" ON "assets"("institution_id", "id");

-- A device reports for exactly one vehicle or one asset.
ALTER TABLE "devices"
    ALTER COLUMN "vehicle_id" DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS "asset_id" UUID,
    ADD COLUMN IF NOT EXISTS "offline_alerted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_asset_fkey";
ALTER TABLE "devices" ADD CONSTRAINT "devices_asset_fkey" FOREIGN KEY ("institution_id", "asset_id") REFERENCES "assets"("institution_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_one_target";
ALTER TABLE "devices" ADD CONSTRAINT "devices_one_target" CHECK (("vehicle_id" IS NULL) <> ("asset_id" IS NULL));
CREATE INDEX IF NOT EXISTS "idx_devices_asset" ON "devices"("asset_id");

ALTER TABLE "gps_logs"
    ALTER COLUMN "vehicle_id" DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS "asset_id" UUID;
ALTER TABLE "gps_logs" DROP CONSTRAINT IF EXISTS "gps_logs_asset_fkey";
ALTER TABLE "gps_logs" ADD CONSTRAINT "gps_logs_asset_fkey" FOREIGN KEY ("institution_id", "asset_id") REFERENCES "assets"("institution_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gps_logs" DROP CONSTRAINT IF EXISTS "gps_logs_one_target";
ALTER TABLE "gps_logs" ADD CONSTRAINT "gps_logs_one_target" CHECK (("vehicle_id" IS NULL) <> ("asset_id" IS NULL));
CREATE INDEX IF NOT EXISTS "idx_gps_logs_asset_time" ON "gps_logs"("asset_id", "recorded_at");

CREATE TABLE IF NOT EXISTS "asset_latest_position" (
    "asset_id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "location" geography(Point, 4326) NOT NULL,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "battery_pct" DOUBLE PRECISION,
    "attrs" JSONB,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "asset_latest_position_pkey" PRIMARY KEY ("asset_id"),
    CONSTRAINT "alp_asset_fkey" FOREIGN KEY ("institution_id", "asset_id") REFERENCES "assets"("institution_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "alp_device_fkey" FOREIGN KEY ("institution_id", "device_id") REFERENCES "devices"("institution_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "asset_latest_position_institution_id_asset_id_key" ON "asset_latest_position"("institution_id", "asset_id");

CREATE TABLE IF NOT EXISTS "guardianships" (
    "institution_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "guardianships_pkey" PRIMARY KEY ("user_id", "asset_id"),
    CONSTRAINT "guardianships_user_fkey" FOREIGN KEY ("institution_id", "user_id") REFERENCES "users"("institution_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "guardianships_asset_fkey" FOREIGN KEY ("institution_id", "asset_id") REFERENCES "assets"("institution_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Circular safe zone; last_inside is the last known state so a crossing alerts once.
CREATE TABLE IF NOT EXISTS "geofences" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radius_m" INTEGER NOT NULL,
    "last_inside" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "geofences_asset_fkey" FOREIGN KEY ("institution_id", "asset_id") REFERENCES "assets"("institution_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_geofences_asset" ON "geofences"("asset_id");

-- Every tenant gets a GUARDIAN role (the people-tracking routes also create it on demand for new tenants).
INSERT INTO "roles" ("id", "institution_id", "name", "description", "is_system", "updated_at")
SELECT gen_random_uuid(), i."id", 'GUARDIAN', 'Follows the people linked to them', true, CURRENT_TIMESTAMP FROM "institutions" i
WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."institution_id" = i."id" AND r."name" = 'GUARDIAN');
