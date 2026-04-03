-- CreateTable: ShiftTask
-- Tasks submitted by staff at checkout to log what they accomplished during their shift

CREATE TABLE IF NOT EXISTS "ShiftTask" (
    "id"            SERIAL NOT NULL,
    "task_id"       TEXT NOT NULL,
    "attendance_id" TEXT NOT NULL,
    "user_id"       TEXT NOT NULL,
    "user_name"     TEXT NOT NULL,
    "facility"      TEXT NOT NULL,
    "tasks"         JSONB NOT NULL,
    "submitted_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ShiftTask_task_id_key" ON "ShiftTask"("task_id");
CREATE INDEX IF NOT EXISTS "ShiftTask_attendance_id_idx" ON "ShiftTask"("attendance_id");
CREATE INDEX IF NOT EXISTS "ShiftTask_user_id_idx" ON "ShiftTask"("user_id");
CREATE INDEX IF NOT EXISTS "ShiftTask_facility_idx" ON "ShiftTask"("facility");
CREATE INDEX IF NOT EXISTS "ShiftTask_submitted_at_idx" ON "ShiftTask"("submitted_at");
