#!/bin/sh
# VChron Backend Startup Script
# Runs prisma db push to apply any pending schema changes, then starts the server.
# This ensures the UserReport table (and any future schema changes) are applied on deploy.

set -e

echo "[VChron] Running Prisma schema push..."
# Use --accept-data-loss only for non-destructive changes (adding tables/columns)
# In production with Prisma Accelerate, db push requires DIRECT_URL for DDL
if [ -n "$DIRECT_URL" ]; then
  npx prisma db push --skip-generate 2>&1 || echo "[VChron] Warning: prisma db push failed (may already be up to date)"
else
  echo "[VChron] No DIRECT_URL set — skipping db push (schema must be applied manually)"
fi

echo "[VChron] Starting server..."
exec node dist/server.js
