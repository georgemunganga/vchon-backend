# ─────────────────────────────────────────────
# Stage 1: Build
# ─────────────────────────────────────────────
FROM node:22-alpine AS builder

# Install pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install openssl (Prisma build requirement) + qpdf (PDF encryption)
RUN apk add --no-cache openssl qpdf

WORKDIR /app

# Copy manifests first for layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# Install ALL dependencies (including devDeps needed for tsc)
RUN pnpm install --frozen-lockfile

# Copy source files
COPY tsconfig.json ./
COPY src ./src/

# Generate Prisma client
RUN pnpm prisma:generate

# Compile TypeScript → dist/
RUN pnpm build

# ─────────────────────────────────────────────
# Stage 2: Production image
# ─────────────────────────────────────────────
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

# openssl  — Prisma runtime requirement
# curl     — useful for health checks / debugging
# qpdf     — PDF encryption for attendance reports
RUN apk add --no-cache openssl curl qpdf

WORKDIR /app

# Copy manifests
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy prisma schema + migrations (needed by prisma migrate deploy at startup)
COPY prisma ./prisma/

# Install production dependencies
# prisma CLI is now in "dependencies" (not devDependencies) so it is included here
RUN pnpm install --frozen-lockfile --prod

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy the full pnpm store (includes generated Prisma client binaries)
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm

EXPOSE 8000

# Copy startup script
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

# On startup: runs `prisma migrate deploy` (if DIRECT_URL is set), then starts node
CMD ["sh", "start.sh"]
