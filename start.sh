#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# VChron Backend Startup Script
#
# On every deploy this script:
#   1. Runs `prisma migrate deploy` using DIRECT_URL (bypasses Prisma Accelerate)
#      to apply any pending SQL migrations in prisma/migrations/
#   2. Starts the Node.js server
#
# DIRECT_URL must be set in Coolify → Environment Variables as the raw
# PostgreSQL connection string (e.g. postgresql://user:pass@host/db?sslmode=require)
# ─────────────────────────────────────────────────────────────────────────────
set -e

echo "[VChron] ── Starting VChron Backend ──"
echo "[VChron] Node: $(node --version)"

# ── Run database migrations ───────────────────────────────────────────────────
if [ -n "$DIRECT_URL" ]; then
  echo "[VChron] Running database migrations (prisma migrate deploy)..."
  # prisma migrate deploy uses DIRECT_URL from the schema datasource directUrl field.
  # It applies all pending migrations in prisma/migrations/ in order.
  # It is idempotent — already-applied migrations are skipped.
  npx prisma migrate deploy 2>&1
  echo "[VChron] Migrations complete."
else
  echo "[VChron] WARNING: DIRECT_URL is not set."
  echo "[VChron] Skipping migrations — add DIRECT_URL in Coolify environment variables."
  echo "[VChron] DIRECT_URL = your raw PostgreSQL connection string"
  echo "[VChron] (NOT the Prisma Accelerate URL — that starts with prisma+postgres://)"
fi

# ── Start the server ──────────────────────────────────────────────────────────
echo "[VChron] Starting server..."
exec node dist/server.js
