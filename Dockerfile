# ─────────────────────────────────────────────
# Stage 1: Build
# ─────────────────────────────────────────────
FROM node:22-alpine AS builder

# Pin pnpm to avoid slow @latest resolution on every build
RUN corepack enable && corepack prepare pnpm@10.6.5 --activate
RUN apk add --no-cache openssl qpdf

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src/

RUN pnpm prisma:generate
RUN pnpm build

# ─────────────────────────────────────────────
# Stage 2: Production image
# ─────────────────────────────────────────────
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@10.6.5 --activate
RUN apk add --no-cache openssl curl qpdf

WORKDIR /app

# Copy the full node_modules from builder — avoids a second pnpm install
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Copy prisma schema + all migration files (needed for migrate deploy at startup)
COPY prisma ./prisma/

# Copy package files (needed by prisma CLI)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

EXPOSE 8000

# On every deploy:
#   1. npx prisma migrate deploy  — applies any new migrations in prisma/migrations/
#                                   (uses DIRECT_URL env var for DDL access)
#                                   (already-applied migrations are skipped)
#   2. node dist/server.js        — starts the server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
