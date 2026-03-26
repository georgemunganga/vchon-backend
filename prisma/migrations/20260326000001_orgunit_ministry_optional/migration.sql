-- Make OrgUnit.ministry_id optional (nullable)
ALTER TABLE "OrgUnit" ALTER COLUMN "ministry_id" DROP NOT NULL;

-- Drop old unique constraint that included ministry_id
ALTER TABLE "OrgUnit" DROP CONSTRAINT IF EXISTS "OrgUnit_name_district_id_ministry_id_key";

-- Add new unique constraint without ministry_id
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_name_district_id_key" UNIQUE ("name", "district_id");
