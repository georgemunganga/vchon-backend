import 'dotenv/config'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyCors from '@fastify/cors'

import authRoutes from './routes/auth'
import dataRoutes from './routes/data'
import attendanceRoutes from './routes/attendance'
import adminRoutes from './routes/admin'
import superuserRoutes from './routes/superuser'

const PORT = parseInt(process.env.PORT || '8000', 10)
const HOST = process.env.HOST || '0.0.0.0'
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',')

const fastify = Fastify({
  logger: {
    level: 'info',
    transport: { target: 'pino-pretty', options: { colorize: true } },
  },
})

async function bootstrap() {
  // CORS
  await fastify.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin || CORS_ORIGINS.includes(origin) || CORS_ORIGINS.includes('*')) {
        cb(null, true)
      } else {
        cb(new Error('Not allowed by CORS'), false)
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })

  // Cookies
  await fastify.register(fastifyCookie)

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', service: 'vchron-fastify', timestamp: new Date().toISOString() }))

  // Root welcome page
  fastify.get('/', async (_req, reply) => {
    const uptime = process.uptime()
    const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
    reply.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VChron API</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; padding: 2rem; }
    .container { max-width: 860px; margin: 0 auto; }
    .header { display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 1px solid #1e293b; }
    .badge { background: #14b8a6; color: #0f172a; font-size: 0.7rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.05em; }
    h1 { font-size: 1.8rem; font-weight: 700; color: #f1f5f9; }
    .subtitle { color: #64748b; font-size: 0.9rem; margin-top: 0.25rem; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 2rem; }
    .stat { background: #1e293b; border: 1px solid #334155; border-radius: 0.75rem; padding: 1rem 1.25rem; }
    .stat-label { font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-value { font-size: 1.25rem; font-weight: 600; color: #14b8a6; margin-top: 0.25rem; }
    .section { margin-bottom: 1.5rem; }
    .section-title { font-size: 0.75rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.75rem; }
    .endpoint { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 1rem; background: #1e293b; border: 1px solid #334155; border-radius: 0.5rem; margin-bottom: 0.4rem; font-family: 'Menlo', 'Courier New', monospace; font-size: 0.82rem; }
    .method { font-weight: 700; font-size: 0.7rem; padding: 0.15rem 0.5rem; border-radius: 0.25rem; min-width: 3.5rem; text-align: center; }
    .get  { background: #0c4a6e; color: #38bdf8; }
    .post { background: #14532d; color: #4ade80; }
    .path { color: #cbd5e1; flex: 1; }
    .desc { color: #475569; font-size: 0.75rem; font-family: sans-serif; }
    .footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #1e293b; color: #475569; font-size: 0.8rem; text-align: center; }
    a { color: #14b8a6; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <div style="display:flex;align-items:center;gap:0.75rem">
          <h1>VChron API</h1>
          <span class="badge">Live</span>
        </div>
        <p class="subtitle">Verified Workforce Intelligence &mdash; Fastify + Prisma + PostgreSQL Accelerate</p>
      </div>
    </div>

    <div class="stats">
      <div class="stat"><div class="stat-label">Status</div><div class="stat-value" style="color:#4ade80">&#x2713; Healthy</div></div>
      <div class="stat"><div class="stat-label">Uptime</div><div class="stat-value">${uptimeStr}</div></div>
      <div class="stat"><div class="stat-label">Version</div><div class="stat-value">1.0.0</div></div>
    </div>

    <div class="section">
      <div class="section-title">System</div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/health</span><span class="desc">Health check &amp; timestamp</span></div>
    </div>

    <div class="section">
      <div class="section-title">Authentication</div>
      <div class="endpoint"><span class="method post">POST</span><span class="path">/api/auth/register</span><span class="desc">Register new user</span></div>
      <div class="endpoint"><span class="method post">POST</span><span class="path">/api/auth/login</span><span class="desc">Email &amp; password login</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/auth/google</span><span class="desc">Initiate Google OAuth 2.0</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/auth/google/callback</span><span class="desc">Google OAuth callback</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/auth/me</span><span class="desc">Get current user (auth required)</span></div>
      <div class="endpoint"><span class="method post">POST</span><span class="path">/api/auth/complete-registration</span><span class="desc">Complete profile after Google sign-in</span></div>
      <div class="endpoint"><span class="method post">POST</span><span class="path">/api/auth/logout</span><span class="desc">Logout &amp; clear session</span></div>
    </div>

    <div class="section">
      <div class="section-title">Data Lookups</div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/provinces</span><span class="desc">All provinces</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/districts/:province</span><span class="desc">Districts by province</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/facilities/:district</span><span class="desc">Facilities by district</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/positions</span><span class="desc">All healthcare positions</span></div>
    </div>

    <div class="section">
      <div class="section-title">Attendance</div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/attendance/status</span><span class="desc">Current duty status</span></div>
      <div class="endpoint"><span class="method post">POST</span><span class="path">/api/attendance</span><span class="desc">Log attendance (report/end shift)</span></div>
      <div class="endpoint"><span class="method post">POST</span><span class="path">/api/attendance/sync</span><span class="desc">Sync offline records</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/attendance/history</span><span class="desc">Personal attendance history</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/shifts/available</span><span class="desc">Available shift types</span></div>
    </div>

    <div class="section">
      <div class="section-title">Admin</div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/admin/users</span><span class="desc">List users (scoped to jurisdiction)</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/admin/attendance</span><span class="desc">Attendance records with filters</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/admin/export/csv</span><span class="desc">Export attendance as CSV</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/admin/export/excel</span><span class="desc">Export attendance as Excel</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/admin/notifications</span><span class="desc">GPS &amp; late notifications</span></div>
    </div>

    <div class="section">
      <div class="section-title">Superuser</div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/superuser/stats</span><span class="desc">System-wide statistics</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/superuser/users</span><span class="desc">All users across all facilities</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/superuser/attendance</span><span class="desc">Global attendance with filters</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/api/superuser/export/excel</span><span class="desc">Global Excel export</span></div>
    </div>

    <div class="footer">
      VChron &mdash; Verified Workforce Intelligence &nbsp;&bull;&nbsp;
      <a href="/health">/health</a> &nbsp;&bull;&nbsp;
      Built with Fastify, Prisma &amp; PostgreSQL Accelerate
    </div>
  </div>
</body>
</html>`)
  })

  // All routes under /api prefix
  fastify.register(async (api) => {
    await api.register(authRoutes)
    await api.register(dataRoutes)
    await api.register(attendanceRoutes)
    await api.register(adminRoutes)
    await api.register(superuserRoutes)
  }, { prefix: '/api' })

  // 404 handler
  fastify.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ detail: 'Route not found' })
  })

  // Error handler
  fastify.setErrorHandler((error, _req, reply) => {
    fastify.log.error(error)
    reply.code(error.statusCode || 500).send({ detail: error.message || 'Internal server error' })
  })

  await fastify.listen({ port: PORT, host: HOST })
  fastify.log.info(`V-Chron Fastify backend running on http://${HOST}:${PORT}`)
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
