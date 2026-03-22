-- Add missing columns to Ministry table
ALTER TABLE "Ministry" ADD COLUMN IF NOT EXISTS "unit_term"  TEXT    NOT NULL DEFAULT 'Facility';
ALTER TABLE "Ministry" ADD COLUMN IF NOT EXISTS "is_active"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Ministry" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Add missing columns to OrgUnit table
ALTER TABLE "OrgUnit" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'facility';

-- Update existing ministries to be active
UPDATE "Ministry" SET "is_active" = true WHERE "is_active" = false;
