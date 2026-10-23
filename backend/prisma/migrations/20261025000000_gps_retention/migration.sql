-- How long vehicle GPS points are kept, per institution: 1, 7, 30 or 90 days (default 7). Idempotent.
-- Existing institutions get 90 so the first clean-up deletes nothing they had; new sign-ups default to 7.
ALTER TABLE "institutions" ADD COLUMN IF NOT EXISTS "gps_retention_days" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "institutions" ALTER COLUMN "gps_retention_days" SET DEFAULT 7;
ALTER TABLE "institutions" DROP CONSTRAINT IF EXISTS "institutions_gps_retention_days_check";
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_gps_retention_days_check" CHECK ("gps_retention_days" IN (1, 7, 30, 90));
