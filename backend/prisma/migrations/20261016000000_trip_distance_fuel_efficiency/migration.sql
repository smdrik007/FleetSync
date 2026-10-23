-- AlterTable
ALTER TABLE "trips" ADD COLUMN "distance_km" DECIMAL(10,3);

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN "fuel_efficiency_kmpl" DECIMAL(6,2);

-- CreateIndex
CREATE INDEX "idx_gps_logs_trip_time" ON "gps_logs"("trip_id", "recorded_at");
