# ─────────────────────────────────────────────
# Stage 1: Build
# ─────────────────────────────────────────────
FROM node:22-alpine AS builder

# Install pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install openssl so Prisma can detect it during build, and qpdf for PDF encryption
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

# Install openssl (Prisma runtime) + curl (available for manual checks) + qpdf (PDF encryption)
RUN apk add --no-cache openssl curl qpdf

WORKDIR /app

# Copy manifests
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy the full pnpm store (includes generated Prisma client binaries)
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm

# Expose the port the server listens on (Coolify reads this)
# The actual port is controlled by the PORT env var set in Coolify
EXPOSE 8000

# No HEALTHCHECK here — Coolify manages healthchecks via its own UI
# to avoid hardcoded port conflicts when Coolify injects a different PORT env var

# Copy startup script
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

# Start server (runs prisma db push if DIRECT_URL is set, then starts node)
CMD ["sh", "start.sh"]
