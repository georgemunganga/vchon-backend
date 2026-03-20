import { FastifyRequest, FastifyReply } from 'fastify'
import prisma from '../lib/prisma'
import { decodeJwtToken } from '../lib/auth'

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  let token: string | undefined

  // 1. Try cookie first
  token = (request.cookies as Record<string, string>)?.session_token

  // 2. Fall back to Authorization header
  if (!token) {
    const authHeader = request.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7)
    }
  }

  if (!token) {
    return reply.code(401).send({ detail: 'Not authenticated' })
  }

  // 3. Try JWT (email/password auth)
  try {
    const payload = decodeJwtToken(token)
    const user = await prisma.user.findUnique({ where: { user_id: payload.user_id } })
    if (!user) return reply.code(401).send({ detail: 'User not found' })
    ;(request as any).user = user
    return
  } catch {
    // Not a valid JWT — try session token
  }

  // 4. Try session token (Google OAuth)
  const session = await prisma.userSession.findUnique({ where: { session_token: token } })
  if (!session) return reply.code(401).send({ detail: 'Invalid session' })

  if (new Date(session.expires_at) < new Date()) {
    return reply.code(401).send({ detail: 'Session expired' })
  }

  const user = await prisma.user.findUnique({ where: { user_id: session.user_id } })
  if (!user) return reply.code(401).send({ detail: 'User not found' })
  ;(request as any).user = user
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply)
  if (reply.sent) return
  const user = (request as any).user
  if (!['admin', 'superuser'].includes(user.role)) {
    return reply.code(403).send({ detail: 'Admin access required' })
  }
}

export async function requireSuperuser(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply)
  if (reply.sent) return
  const user = (request as any).user
  if (user.role !== 'superuser') {
    return reply.code(403).send({ detail: 'Super user access required' })
  }
}
