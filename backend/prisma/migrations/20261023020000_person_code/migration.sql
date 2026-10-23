-- Optional human-readable ID for a tracked person (student/resident number), unique per institution. Idempotent.
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "code" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_assets_code" ON "assets"("institution_id", "code");
