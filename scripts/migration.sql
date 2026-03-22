-- VChron Schema Migration v2
-- Adds all missing columns and tables to bring the production DB in sync with schema.prisma
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS guards)

-- ─── 1. Add missing columns to User table ───────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "is_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "setup_complete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ministry_id" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "org_unit_id" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "delete_requested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "delete_requested_at" TIMESTAMP;

-- ─── 2. Mark existing users with position+facility set as verified+setup_complete ─
UPDATE "User" SET "is_verified" = true, "setup_complete" = true
WHERE "position" IS NOT NULL AND "facility" IS NOT NULL AND "is_verified" = false;

-- ─── 3. Create OtpCode table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OtpCode" (
  "id"         SERIAL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "code"       TEXT NOT NULL,
  "purpose"    TEXT NOT NULL,
  "used"       BOOLEAN NOT NULL DEFAULT false,
  "expires_at" TIMESTAMP NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "OtpCode_identifier_idx" ON "OtpCode"("identifier");
CREATE INDEX IF NOT EXISTS "OtpCode_expires_at_idx" ON "OtpCode"("expires_at");

-- ─── 4. Create Province table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Province" (
  "id"   SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE
);

-- ─── 5. Create District table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "District" (
  "id"          SERIAL PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "province_id" INTEGER NOT NULL REFERENCES "Province"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "District_province_id_idx" ON "District"("province_id");

-- ─── 6. Create Ministry table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Ministry" (
  "id"   SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "code" TEXT
);

-- ─── 7. Create OrgUnit table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OrgUnit" (
  "id"          SERIAL PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "type"        TEXT NOT NULL DEFAULT 'facility',
  "ministry_id" INTEGER NOT NULL REFERENCES "Ministry"("id") ON DELETE CASCADE,
  "district_id" INTEGER NOT NULL REFERENCES "District"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "OrgUnit_ministry_id_idx" ON "OrgUnit"("ministry_id");
CREATE INDEX IF NOT EXISTS "OrgUnit_district_id_idx" ON "OrgUnit"("district_id");

-- ─── 8. Add FK indexes on User for ministry/org_unit ─────────────────────────
CREATE INDEX IF NOT EXISTS "User_ministry_id_idx" ON "User"("ministry_id");
CREATE INDEX IF NOT EXISTS "User_org_unit_id_idx" ON "User"("org_unit_id");

-- ─── 9. Create DeletionRequest table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DeletionRequest" (
  "id"            SERIAL PRIMARY KEY,
  "request_id"    TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::TEXT,
  "user_id"       TEXT NOT NULL,
  "user_name"     TEXT NOT NULL,
  "user_email"    TEXT NOT NULL,
  "reason"        TEXT,
  "status"        TEXT NOT NULL DEFAULT 'pending',
  "reviewed_by"   TEXT,
  "reviewer_name" TEXT,
  "reviewed_at"   TIMESTAMP,
  "created_at"    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "DeletionRequest_status_idx" ON "DeletionRequest"("status");
CREATE INDEX IF NOT EXISTS "DeletionRequest_user_id_idx" ON "DeletionRequest"("user_id");

-- ─── 10. Create AuditLog table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id"          SERIAL PRIMARY KEY,
  "actor_id"    TEXT NOT NULL,
  "actor_name"  TEXT NOT NULL,
  "actor_role"  TEXT NOT NULL,
  "action"      TEXT NOT NULL,
  "target_type" TEXT,
  "target_id"   TEXT,
  "metadata"    JSONB,
  "created_at"  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AuditLog_actor_id_idx" ON "AuditLog"("actor_id");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX IF NOT EXISTS "AuditLog_created_at_idx" ON "AuditLog"("created_at");

-- ─── 11. Create UserReport table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "UserReport" (
  "id"           SERIAL PRIMARY KEY,
  "report_id"    TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::TEXT,
  "user_id"      TEXT NOT NULL REFERENCES "User"("user_id") ON DELETE CASCADE,
  "user_name"    TEXT NOT NULL,
  "period_label" TEXT NOT NULL,
  "period_type"  TEXT NOT NULL,
  "date_from"    TIMESTAMP NOT NULL,
  "date_to"      TIMESTAMP NOT NULL,
  "record_count" INTEGER NOT NULL DEFAULT 0,
  "file_url"     TEXT,
  "emailed"      BOOLEAN NOT NULL DEFAULT false,
  "emailed_at"   TIMESTAMP,
  "created_at"   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "UserReport_user_id_idx" ON "UserReport"("user_id");
CREATE INDEX IF NOT EXISTS "UserReport_created_at_idx" ON "UserReport"("created_at");

-- ─── 12. Add lunch_duration_mins to ShiftConfig if missing ───────────────────
ALTER TABLE "ShiftConfig" ADD COLUMN IF NOT EXISTS "lunch_duration_mins" INTEGER NOT NULL DEFAULT 60;

