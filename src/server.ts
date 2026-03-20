import 'dotenv/config'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyCors from '@fastify/cors'

import authRoutes from './routes/auth'
import dataRoutes from './routes/data'
import attendanceRoutes from './routes/attendance'
import adminRoutes from './routes/admin'
import superuserRoutes from './routes/superuser'

const PORT = parseInt(process.env.PORT || '8001', 10)
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
