# V-Chron Fastify Backend

A complete drop-in replacement for the Python FastAPI backend, built with:
- **Fastify** (Node.js high-performance HTTP framework)
- **Prisma ORM** with **Prisma Accelerate** (connection pooling + caching)
- **PostgreSQL** (via Prisma Postgres)
- **TypeScript** (strict type safety)

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy and configure environment
cp .env.example .env
# Edit .env with your Prisma Accelerate URL and JWT secret

# 3. Push schema to database (first time only)
pnpm prisma:generate
npx prisma db push

# 4. Start development server
pnpm dev
```

The server starts on **port 8001** by default.

## Connecting the Frontend

In the frontend `.env` or wherever `API` is defined, change:
```
REACT_APP_BACKEND_URL=http://localhost:8001
```
No other frontend changes are needed — all API contracts are identical.

## Project Structure

```
backend-fastify/
├── prisma/
│   └── schema.prisma          # Database schema
├── src/
│   ├── lib/
│   │   ├── prisma.ts          # Prisma client singleton (with Accelerate)
│   │   ├── auth.ts            # JWT, bcrypt, haversine helpers
│   │   ├── constants.ts       # Provinces, districts, facilities, positions
│   │   ├── adminScope.ts      # Jurisdiction-based query scoping
│   │   └── notifications.ts   # GPS notification logic
│   ├── plugins/
│   │   └── authenticate.ts    # Auth middleware (JWT + session cookie)
│   ├── routes/
│   │   ├── auth.ts            # /api/auth/*
│   │   ├── data.ts            # /api/provinces, /districts, /facilities, etc.
│   │   ├── attendance.ts      # /api/attendance/*, /api/shifts/*
│   │   ├── admin.ts           # /api/admin/*
│   │   └── superuser.ts       # /api/superuser/*
│   └── server.ts              # Entry point
├── .env                       # Local secrets (git-ignored)
├── .env.example               # Template
├── package.json
└── tsconfig.json
```

## API Endpoints (identical to FastAPI backend)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | None | Register with email/password |
| POST | /api/auth/login | None | Login with email/password |
| POST | /api/auth/session | None | Google OAuth session |
| GET | /api/auth/me | User | Get current user |
| POST | /api/auth/complete-registration | User | Complete OAuth registration |
| POST | /api/auth/logout | None | Logout |
| GET | /api/provinces | None | List provinces |
| GET | /api/districts/:province | None | Districts for province |
| GET | /api/facilities/:district | None | Facilities for district |
| GET | /api/facilities | None | All facilities |
| GET | /api/positions | None | All positions |
| GET | /api/areas | None | Areas of allocation |
| GET | /api/shifts/available | User | Available shifts |
| POST | /api/attendance | User | Record attendance |
| POST | /api/attendance/sync | User | Offline sync |
| GET | /api/attendance/status | User | Current duty status |
| GET | /api/attendance/me | User | My attendance history |
| GET | /api/admin/attendance/realtime | Admin | Today's attendance |
| GET | /api/admin/users | Admin | User management |
| PUT | /api/admin/users/:id | Admin | Update user |
| PUT | /api/admin/users/:id/shift | Admin | Assign shift |
| GET | /api/admin/attendance | Admin | Filtered attendance |
| GET | /api/admin/notifications | Admin | GPS notifications |
| PUT | /api/admin/notifications/:id/read | Admin | Mark read |
| PUT | /api/admin/notifications/read-all | Admin | Mark all read |
| GET | /api/admin/shifts | Admin | Shift config |
| GET | /api/admin/export | Admin | Excel export |
| GET | /api/admin/send-backup | Admin | Email backup |
| GET | /api/superuser/stats | Superuser | System stats |
| GET | /api/superuser/users | Superuser | All users |
| DELETE | /api/superuser/users/:id | Superuser | Delete user |
| PUT | /api/superuser/users/:id/role | Superuser | Change role |
| PUT | /api/superuser/users/:id/reset-password | Superuser | Reset password |
| PUT | /api/superuser/users/:id/jurisdiction | Superuser | Assign jurisdiction |
| GET | /api/superuser/facilities | Superuser | All facilities |
| POST | /api/superuser/facilities | Superuser | Create facility |
| DELETE | /api/superuser/facilities/:id | Superuser | Delete facility |
| GET | /api/superuser/provinces | Superuser | Provinces |
| GET | /api/superuser/districts | Superuser | All districts |
| GET | /api/superuser/shifts | Superuser | Shift config |
| PUT | /api/superuser/shifts | Superuser | Update shift config |
| GET | /api/superuser/attendance-report | Superuser | Full report |
| GET | /api/superuser/export | Superuser | Excel export |
