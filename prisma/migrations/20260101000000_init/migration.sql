-- VChron Initial Migration
-- Creates the full schema from scratch. Safe to run on a fresh database.

-- ─── Province ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Province" (
  "id"   SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE
);

-- ─── District ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "District" (
  "id"          SERIAL PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "province_id" INTEGER NOT NULL REFERENCES "Province"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "District_province_id_idx" ON "District"("province_id");

-- ─── Ministry ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Ministry" (
  "id"   SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "code" TEXT
);

-- ─── OrgUnit ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OrgUnit" (
  "id"          SERIAL PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "type"        TEXT NOT NULL DEFAULT 'facility',
  "ministry_id" INTEGER NOT NULL REFERENCES "Ministry"("id") ON DELETE CASCADE,
  "district_id" INTEGER NOT NULL REFERENCES "District"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "OrgUnit_ministry_id_idx" ON "OrgUnit"("ministry_id");
CREATE INDEX IF NOT EXISTS "OrgUnit_district_id_idx" ON "OrgUnit"("district_id");

-- ─── User ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "User" (
  "id"                    SERIAL PRIMARY KEY,
  "user_id"               TEXT NOT NULL UNIQUE,
  "email"                 TEXT NOT NULL UNIQUE,
  "password"              TEXT,
  "name"                  TEXT NOT NULL,
  "phone_number"          TEXT,
  "is_verified"           BOOLEAN NOT NULL DEFAULT false,
  "setup_complete"        BOOLEAN NOT NULL DEFAULT false,
  "ministry_id"           INTEGER REFERENCES "Ministry"("id"),
  "org_unit_id"           INTEGER REFERENCES "OrgUnit"("id"),
  "position"              TEXT,
  "province"              TEXT,
  "district"              TEXT,
  "facility"              TEXT,
  "area_of_allocation"    TEXT,
  "picture"               TEXT,
  "role"                  TEXT NOT NULL DEFAULT 'user',
  "assigned_scope"        JSONB,
  "assigned_jurisdiction" JSONB,
  "assigned_shift"        TEXT,
  "custom_shift_start"    TEXT,
  "custom_shift_end"      TEXT,
  "delete_requested"      BOOLEAN NOT NULL DEFAULT false,
  "delete_requested_at"   TIMESTAMP,
  "created_at"            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "User_role_idx"        ON "User"("role");
CREATE INDEX IF NOT EXISTS "User_facility_idx"    ON "User"("facility");
CREATE INDEX IF NOT EXISTS "User_district_idx"    ON "User"("district");
CREATE INDEX IF NOT EXISTS "User_ministry_id_idx" ON "User"("ministry_id");
CREATE INDEX IF NOT EXISTS "User_org_unit_id_idx" ON "User"("org_unit_id");

-- ─── UserSession ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "UserSession" (
  "id"            SERIAL PRIMARY KEY,
  "session_token" TEXT NOT NULL UNIQUE,
  "user_id"       TEXT NOT NULL REFERENCES "User"("user_id") ON DELETE CASCADE,
  "expires_at"    TIMESTAMP NOT NULL,
  "created_at"    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "UserSession_user_id_idx"    ON "UserSession"("user_id");
CREATE INDEX IF NOT EXISTS "UserSession_expires_at_idx" ON "UserSession"("expires_at");

-- ─── OtpCode ─────────────────────────────────────────────────────────────────
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

-- ─── Attendance ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Attendance" (
  "id"                 SERIAL PRIMARY KEY,
  "attendance_id"      TEXT NOT NULL UNIQUE,
  "offline_id"         TEXT UNIQUE,
  "user_id"            TEXT NOT NULL REFERENCES "User"("user_id") ON DELETE CASCADE,
  "user_name"          TEXT NOT NULL,
  "position"           TEXT NOT NULL,
  "facility"           TEXT NOT NULL,
  "area_of_allocation" TEXT,
  "action"             TEXT NOT NULL,
  "timestamp"          TIMESTAMP NOT NULL,
  "latitude"           DOUBLE PRECISION,
  "longitude"          DOUBLE PRECISION,
  "shift_type"         TEXT,
  "synced"             BOOLEAN NOT NULL DEFAULT true,
  "ministry_id"        INTEGER
);
CREATE INDEX IF NOT EXISTS "Attendance_user_id_idx"            ON "Attendance"("user_id");
CREATE INDEX IF NOT EXISTS "Attendance_facility_idx"           ON "Attendance"("facility");
CREATE INDEX IF NOT EXISTS "Attendance_timestamp_idx"          ON "Attendance"("timestamp");
CREATE INDEX IF NOT EXISTS "Attendance_ministry_id_idx"        ON "Attendance"("ministry_id");
CREATE INDEX IF NOT EXISTS "Attendance_user_id_timestamp_idx"  ON "Attendance"("user_id", "timestamp" DESC);

-- ─── Notification ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Notification" (
  "id"              SERIAL PRIMARY KEY,
  "notification_id" TEXT NOT NULL UNIQUE,
  "type"            TEXT NOT NULL,
  "user_id"         TEXT NOT NULL,
  "user_name"       TEXT NOT NULL,
  "facility"        TEXT NOT NULL,
  "message"         TEXT NOT NULL,
  "distance_meters" INTEGER,
  "latitude"        DOUBLE PRECISION,
  "longitude"       DOUBLE PRECISION,
  "timestamp"       TIMESTAMP NOT NULL,
  "read"            BOOLEAN NOT NULL DEFAULT false,
  "attendance_id"   TEXT
);
CREATE INDEX IF NOT EXISTS "Notification_facility_idx"  ON "Notification"("facility");
CREATE INDEX IF NOT EXISTS "Notification_read_idx"      ON "Notification"("read");
CREATE INDEX IF NOT EXISTS "Notification_timestamp_idx" ON "Notification"("timestamp");

-- ─── ShiftConfig ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ShiftConfig" (
  "id"                   SERIAL PRIMARY KEY,
  "config_id"            TEXT NOT NULL UNIQUE DEFAULT 'default',
  "morning_start"        TEXT NOT NULL DEFAULT '06:00',
  "morning_end"          TEXT NOT NULL DEFAULT '14:00',
  "afternoon_start"      TEXT NOT NULL DEFAULT '14:00',
  "afternoon_end"        TEXT NOT NULL DEFAULT '22:00',
  "night_start"          TEXT NOT NULL DEFAULT '22:00',
  "night_end"            TEXT NOT NULL DEFAULT '06:00',
  "four_off_start"       TEXT NOT NULL DEFAULT '07:00',
  "four_off_end"         TEXT NOT NULL DEFAULT '19:00',
  "on_call_start"        TEXT NOT NULL DEFAULT '00:00',
  "on_call_end"          TEXT NOT NULL DEFAULT '23:59',
  "grace_period_minutes" INTEGER NOT NULL DEFAULT 15,
  "lunch_duration_mins"  INTEGER NOT NULL DEFAULT 60,
  "updated_at"           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── DeletionRequest ─────────────────────────────────────────────────────────
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
CREATE INDEX IF NOT EXISTS "DeletionRequest_status_idx"     ON "DeletionRequest"("status");
CREATE INDEX IF NOT EXISTS "DeletionRequest_user_id_idx"    ON "DeletionRequest"("user_id");
CREATE INDEX IF NOT EXISTS "DeletionRequest_created_at_idx" ON "DeletionRequest"("created_at");

-- ─── AuditLog ────────────────────────────────────────────────────────────────
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
CREATE INDEX IF NOT EXISTS "AuditLog_actor_id_idx"   ON "AuditLog"("actor_id");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx"     ON "AuditLog"("action");
CREATE INDEX IF NOT EXISTS "AuditLog_created_at_idx" ON "AuditLog"("created_at");

-- ─── UserReport ──────────────────────────────────────────────────────────────
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
CREATE INDEX IF NOT EXISTS "UserReport_user_id_idx"    ON "UserReport"("user_id");
CREATE INDEX IF NOT EXISTS "UserReport_created_at_idx" ON "UserReport"("created_at");
