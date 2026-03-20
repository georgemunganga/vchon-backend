# ─────────────────────────────────────────────
# Stage 1: Build
# ─────────────────────────────────────────────
FROM node:22-alpine AS builder

# Install pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install openssl so Prisma can detect it during build
RUN apk add --no-cache openssl

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

# Install openssl (Prisma runtime) + curl (healthcheck)
# Alpine's built-in BusyBox wget does not support -qO- reliably
RUN apk add --no-cache openssl curl

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

# Expose port
EXPOSE 8000

# Health check — use curl (reliable on Alpine, unlike BusyBox wget)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fs http://localhost:8000/health || exit 1

# Start server
CMD ["node", "dist/server.js"]
