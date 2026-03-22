-- Add missing columns to OrgUnit table
ALTER TABLE "OrgUnit" ADD COLUMN IF NOT EXISTS "latitude"   FLOAT;
ALTER TABLE "OrgUnit" ADD COLUMN IF NOT EXISTS "longitude"  FLOAT;
ALTER TABLE "OrgUnit" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Add unique constraint if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrgUnit_name_district_id_ministry_id_key'
  ) THEN
    ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_name_district_id_ministry_id_key" 
      UNIQUE ("name", "district_id", "ministry_id");
  END IF;
END $$;
