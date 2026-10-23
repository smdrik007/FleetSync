-- Device ingest: catalog of device types, per-device key, battery and free-form attributes on positions.
-- Idempotent (IF NOT EXISTS) because the dev database was synced without `migrate deploy`.

CREATE TABLE IF NOT EXISTS "device_types" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "default_interval_s" INTEGER NOT NULL,
    "capabilities" TEXT[],
    "setup_template" TEXT NOT NULL,
    CONSTRAINT "device_types_pkey" PRIMARY KEY ("code")
);

ALTER TABLE "devices"
    ADD COLUMN IF NOT EXISTS "api_key_hash" TEXT,
    ADD COLUMN IF NOT EXISTS "reporting_interval_s" INTEGER,
    ADD COLUMN IF NOT EXISTS "last_battery_pct" DOUBLE PRECISION;
CREATE UNIQUE INDEX IF NOT EXISTS "devices_api_key_hash_key" ON "devices"("api_key_hash");

ALTER TABLE "gps_logs"
    ADD COLUMN IF NOT EXISTS "battery_pct" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "attrs" JSONB;

ALTER TABLE "vehicle_latest_position"
    ADD COLUMN IF NOT EXISTS "battery_pct" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "attrs" JSONB;

INSERT INTO "device_types" ("code", "name", "family", "adapter", "default_interval_s", "capabilities", "setup_template") VALUES
('phone', 'Driver phone (FleetSync app)', 'app', 'driver-app', 5, ARRAY['trip_bound'],
 'No setup. The driver''s phone reports while a trip is in progress.'),
('esp32-json', 'Microcontroller (ESP32 / Arduino, HTTP JSON)', 'diy', 'json', 30, ARRAY['battery','sos','ignition','batch'],
 E'POST JSON to {{server}}/api/v1/ingest/json\nHeader: Authorization: Bearer {{key}}\nBody: one point or an array of points (max 500, send buffered ones together):\n{"ts":"2026-10-22T08:30:00Z","lat":22.8456,"lng":89.5403,"speed":12.5,"heading":90,"battery":87,"sos":false}\nts is UTC (ISO 8601 or epoch seconds); speed is km/h. Device id: {{imei}}.'),
('osmand', 'Phone tracker app (Traccar Client / OsmAnd, HTTP GET)', 'app', 'osmand', 30, ARRAY['battery'],
 E'Server URL: {{server}}/api/v1/ingest/osmand?key={{key}}\nDevice identifier: {{imei}}\nSpeed is read as knots (the OsmAnd convention). Use HTTPS: the key travels in the URL.'),
('traccar-gateway', 'Tracker or band via Traccar gateway (GT06, JT808, watch protocols...)', 'gateway', 'traccar', 60, ARRAY['battery','sos','ignition'],
 E'Point the device at the Traccar server (host and port for its protocol, set by SMS command or the vendor app).\nUse {{imei}} as the device identifier. No key goes on the device.')
ON CONFLICT ("code") DO NOTHING;
