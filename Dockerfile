# ─────────────────────────────────────────────
# Stage 1: Build
# ─────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate
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

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache openssl curl qpdf

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy prisma schema + all migration files
COPY prisma ./prisma/

# Install production deps (prisma CLI is in dependencies, so it is included)
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm

EXPOSE 8000

# On every deploy:
#   1. npx prisma migrate deploy  — applies any new migrations in prisma/migrations/
#                                   (uses DIRECT_URL env var for DDL access)
#                                   (already-applied migrations are skipped)
#   2. node dist/server.js        — starts the server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
