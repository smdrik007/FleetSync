-- What an institution tracks: vehicle | people | things. Existing institutions track vehicles. Idempotent.
ALTER TABLE "institutions" ADD COLUMN IF NOT EXISTS "tracking_type" TEXT NOT NULL DEFAULT 'vehicle';
ALTER TABLE "institutions" DROP CONSTRAINT IF EXISTS "institutions_tracking_type_check";
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_tracking_type_check" CHECK ("tracking_type" IN ('vehicle', 'people', 'things'));
