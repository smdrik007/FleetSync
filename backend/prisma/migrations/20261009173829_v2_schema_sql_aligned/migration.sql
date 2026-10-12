-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateTable
CREATE TABLE "institutions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "plan_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "start_date" DATE NOT NULL DEFAULT current_date,
    "end_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "admin_level" TEXT NOT NULL DEFAULT 'support',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "user_id" UUID,
    "employee_code" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "license_number" TEXT NOT NULL,
    "license_class" TEXT,
    "license_expiry" DATE,
    "employment_status" TEXT NOT NULL DEFAULT 'active',
    "hired_at" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "vehicle_models" (
    "id" UUID NOT NULL,
    "institution_id" UUID,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "fuel_type" TEXT,
    "capacity" INTEGER,

    CONSTRAINT "vehicle_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stops" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "route_id" UUID NOT NULL,
    "stop_id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "stop_order" INTEGER NOT NULL,

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("route_id","stop_id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "assigned_driver_id" UUID,
    "assigned_route_id" UUID,
    "vehicle_number" TEXT NOT NULL,
    "plate_number" TEXT NOT NULL,
    "current_status" TEXT NOT NULL DEFAULT 'idle',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "device_type" TEXT NOT NULL,
    "imei" TEXT NOT NULL,
    "sim_iccid" TEXT,
    "firmware_version" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "installed_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "route_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gps_logs" (
    "id" BIGSERIAL NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "institution_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "trip_id" UUID,
    "location" geography(Point, 4326) NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "ignition_on" BOOLEAN,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gps_logs_pkey" PRIMARY KEY ("id","recorded_at")
);

-- CreateTable
CREATE TABLE "vehicle_latest_position" (
    "vehicle_id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "trip_id" UUID,
    "location" geography(Point, 4326) NOT NULL,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "ignition_on" BOOLEAN,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_latest_position_pkey" PRIMARY KEY ("vehicle_id")
);

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "cost" DECIMAL(12,2),
    "service_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_logs" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "logged_by_user_id" UUID NOT NULL,
    "volume" DECIMAL(10,2) NOT NULL,
    "total_cost" DECIMAL(12,2) NOT NULL,
    "log_date" DATE NOT NULL DEFAULT current_date,

    CONSTRAINT "fuel_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "institutions_slug_key" ON "institutions"("slug");

-- CreateIndex
CREATE INDEX "idx_subscriptions_institution" ON "subscriptions"("institution_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_institution_id_id_key" ON "users"("institution_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_user_id_key" ON "drivers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_institution_id_id_key" ON "drivers"("institution_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_institution_id_license_number_key" ON "drivers"("institution_id", "license_number");

-- CreateIndex
CREATE UNIQUE INDEX "roles_institution_id_id_key" ON "roles"("institution_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_institution_id_name_key" ON "roles"("institution_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "idx_user_roles_role" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "idx_role_permissions_permission" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "idx_vehicle_models_institution" ON "vehicle_models"("institution_id");

-- CreateIndex
CREATE UNIQUE INDEX "routes_institution_id_id_key" ON "routes"("institution_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "routes_institution_id_name_key" ON "routes"("institution_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "stops_institution_id_id_key" ON "stops"("institution_id", "id");

-- CreateIndex
CREATE INDEX "idx_route_stops_stop" ON "route_stops"("stop_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_route_id_stop_order_key" ON "route_stops"("route_id", "stop_order");

-- CreateIndex
CREATE INDEX "idx_vehicles_model" ON "vehicles"("model_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_institution_id_id_key" ON "vehicles"("institution_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_institution_id_vehicle_number_key" ON "vehicles"("institution_id", "vehicle_number");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_institution_id_plate_number_key" ON "vehicles"("institution_id", "plate_number");

-- CreateIndex
CREATE UNIQUE INDEX "devices_imei_key" ON "devices"("imei");

-- CreateIndex
CREATE INDEX "idx_devices_vehicle" ON "devices"("vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_institution_id_id_key" ON "devices"("institution_id", "id");

-- CreateIndex
CREATE INDEX "idx_trips_vehicle_started" ON "trips"("vehicle_id");

-- CreateIndex
CREATE INDEX "idx_trips_driver_started" ON "trips"("driver_id");

-- CreateIndex
CREATE UNIQUE INDEX "trips_institution_id_id_key" ON "trips"("institution_id", "id");

-- CreateIndex
CREATE INDEX "idx_gps_logs_vehicle_time" ON "gps_logs"("vehicle_id");

-- CreateIndex
CREATE INDEX "idx_vlp_institution" ON "vehicle_latest_position"("institution_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_latest_position_institution_id_vehicle_id_key" ON "vehicle_latest_position"("institution_id", "vehicle_id");

-- CreateIndex
CREATE INDEX "idx_maintenance_vehicle_date" ON "maintenance_records"("vehicle_id");

-- CreateIndex
CREATE INDEX "idx_fuel_vehicle_date" ON "fuel_logs"("vehicle_id");

-- CreateIndex
CREATE INDEX "idx_fuel_user" ON "fuel_logs"("logged_by_user_id");

-- CreateIndex
CREATE INDEX "idx_notifications_user_unread" ON "notifications"("user_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_models" ADD CONSTRAINT "vehicle_models_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stops" ADD CONSTRAINT "stops_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "stops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "vehicle_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_institution_id_assigned_driver_id_fkey" FOREIGN KEY ("institution_id", "assigned_driver_id") REFERENCES "drivers"("institution_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_institution_id_assigned_route_id_fkey" FOREIGN KEY ("institution_id", "assigned_route_id") REFERENCES "routes"("institution_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_institution_id_vehicle_id_fkey" FOREIGN KEY ("institution_id", "vehicle_id") REFERENCES "vehicles"("institution_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_institution_id_vehicle_id_fkey" FOREIGN KEY ("institution_id", "vehicle_id") REFERENCES "vehicles"("institution_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_institution_id_driver_id_fkey" FOREIGN KEY ("institution_id", "driver_id") REFERENCES "drivers"("institution_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_institution_id_route_id_fkey" FOREIGN KEY ("institution_id", "route_id") REFERENCES "routes"("institution_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_logs" ADD CONSTRAINT "gps_logs_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_logs" ADD CONSTRAINT "gps_logs_institution_id_vehicle_id_fkey" FOREIGN KEY ("institution_id", "vehicle_id") REFERENCES "vehicles"("institution_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_logs" ADD CONSTRAINT "gps_logs_institution_id_device_id_fkey" FOREIGN KEY ("institution_id", "device_id") REFERENCES "devices"("institution_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_logs" ADD CONSTRAINT "gps_logs_institution_id_trip_id_fkey" FOREIGN KEY ("institution_id", "trip_id") REFERENCES "trips"("institution_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_latest_position" ADD CONSTRAINT "vehicle_latest_position_institution_id_vehicle_id_fkey" FOREIGN KEY ("institution_id", "vehicle_id") REFERENCES "vehicles"("institution_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_latest_position" ADD CONSTRAINT "vehicle_latest_position_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_latest_position" ADD CONSTRAINT "vehicle_latest_position_institution_id_device_id_fkey" FOREIGN KEY ("institution_id", "device_id") REFERENCES "devices"("institution_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_latest_position" ADD CONSTRAINT "vehicle_latest_position_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_institution_id_vehicle_id_fkey" FOREIGN KEY ("institution_id", "vehicle_id") REFERENCES "vehicles"("institution_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_institution_id_vehicle_id_fkey" FOREIGN KEY ("institution_id", "vehicle_id") REFERENCES "vehicles"("institution_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_institution_id_logged_by_user_id_fkey" FOREIGN KEY ("institution_id", "logged_by_user_id") REFERENCES "users"("institution_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_institution_id_user_id_fkey" FOREIGN KEY ("institution_id", "user_id") REFERENCES "users"("institution_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
