-- Add ministry_id to Attendance table for ministry-level filtering
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "ministry_id" INTEGER;
CREATE INDEX IF NOT EXISTS "Attendance_ministry_id_idx" ON "Attendance"("ministry_id");

-- Add Position table if not exists (needed by seed)
CREATE TABLE IF NOT EXISTS "Position" (
  "id"          SERIAL PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "ministry_id" INTEGER REFERENCES "Ministry"("id") ON DELETE SET NULL,
  UNIQUE("name", "ministry_id")
);
CREATE INDEX IF NOT EXISTS "Position_ministry_id_idx" ON "Position"("ministry_id");
