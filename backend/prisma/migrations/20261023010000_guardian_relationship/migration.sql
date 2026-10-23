-- How a guardian is related to the person they follow (Mother, Teacher, Caregiver...). Idempotent.
ALTER TABLE "guardianships" ADD COLUMN IF NOT EXISTS "relationship" TEXT;
