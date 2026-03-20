import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import prisma from '../lib/prisma'
import {
  hashPassword, verifyPassword, createJwtToken, COOKIE_OPTIONS
} from '../lib/auth'
import {
  PROVINCES, DISTRICTS, FACILITIES_BY_DISTRICT, POSITIONS
} from '../lib/constants'
import { authenticate } from '../plugins/authenticate'

// ─── Google OAuth config (set via env vars) ───────────────────────────────────
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI  || ''
const FRONTEND_URL         = process.env.FRONTEND_URL         || 'http://localhost:3000'

function userResponse(u: any) {
  return {
    user_id:            u.user_id,
    email:              u.email,
    name:               u.name,
    phone_number:       u.phone_number       ?? null,
    position:           u.position           ?? null,
    province:           u.province           ?? null,
    district:           u.district           ?? null,
    facility:           u.facility           ?? null,
    area_of_allocation: u.area_of_allocation ?? null,
    picture:            u.picture            ?? null,
    role:               u.role               ?? 'user',
    assigned_scope:     u.assigned_scope     ?? null,
    assigned_shift:     u.assigned_shift     ?? null,
    created_at:         u.created_at?.toISOString() ?? null,
  }
}

export default async function authRoutes(fastify: FastifyInstance) {

  // ─── POST /api/auth/register ────────────────────────────────────────────────
  fastify.post('/auth/register', async (request, reply) => {
    const body = request.body as any
    const { email, password, name, phone_number, position, province, district, facility } = body

    if (!email || !password || !name || !phone_number || !position || !province || !district || !facility) {
      return reply.code(400).send({ detail: 'All fields are required' })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return reply.code(400).send({ detail: 'Email already registered' })

    const provinceNames = PROVINCES.map((p) => p.name)
    if (!provinceNames.includes(province)) return reply.code(400).send({ detail: 'Invalid province' })

    const hardcodedDistricts = DISTRICTS[province] || []
    const dbFacsDistricts = await prisma.facility.findMany({ where: { province }, select: { district: true } })
    const allDistricts = new Set([...hardcodedDistricts, ...dbFacsDistricts.map((f) => f.district)])
    if (!allDistricts.has(district)) return reply.code(400).send({ detail: 'Invalid district for selected province' })

    const hardcodedFacilities = FACILITIES_BY_DISTRICT[district] || []
    const dbFacs = await prisma.facility.findMany({ where: { district }, select: { name: true } })
    const allFacilities = new Set([...hardcodedFacilities, ...dbFacs.map((f) => f.name)])
    if (!allFacilities.has(facility)) return reply.code(400).send({ detail: 'Invalid facility for selected district' })

    if (!POSITIONS.includes(position)) return reply.code(400).send({ detail: 'Invalid position' })

    const userId = `user_${uuidv4().replace(/-/g, '').slice(0, 12)}`
    const user = await prisma.user.create({
      data: { user_id: userId, email, password: hashPassword(password), name, phone_number, position, province, district, facility, role: 'user' },
    })

    const token = createJwtToken(userId)
    reply.setCookie('session_token', token, COOKIE_OPTIONS)
    return reply.send({ access_token: token, token_type: 'bearer', user: userResponse(user) })
  })

  // ─── POST /api/auth/login ───────────────────────────────────────────────────
  fastify.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body as any
    if (!email || !password) return reply.code(400).send({ detail: 'Email and password required' })

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) return reply.code(401).send({ detail: 'Invalid email or password' })
    if (!user.password) return reply.code(401).send({ detail: 'Please use Google sign-in for this account' })
    if (!verifyPassword(password, user.password)) return reply.code(401).send({ detail: 'Invalid email or password' })

    const token = createJwtToken(user.user_id)
    reply.setCookie('session_token', token, COOKIE_OPTIONS)
    return reply.send({ access_token: token, token_type: 'bearer', user: userResponse(user) })
  })

  // ─── GET /api/auth/google  ──────────────────────────────────────────────────
  // Step 1: Redirect browser to Google's OAuth consent screen
  fastify.get('/auth/google', async (request, reply) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
      return reply.code(500).send({ detail: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI env vars.' })
    }

    const params = new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      redirect_uri:  GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope:         'openid email profile',
      access_type:   'offline',
      prompt:        'select_account',
    })

    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
  })

  // ─── GET /api/auth/google/callback ─────────────────────────────────────────
  // Step 2: Google redirects here with ?code=...  Exchange code → tokens → user
  fastify.get('/auth/google/callback', async (request, reply) => {
    const { code, error } = request.query as any

    if (error || !code) {
      return reply.redirect(`${FRONTEND_URL}/login?error=google_auth_failed`)
    }

    // Exchange authorization code for access token
    let tokenRes: any
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id:     GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri:  GOOGLE_REDIRECT_URI,
          grant_type:    'authorization_code',
        }).toString(),
      })
      tokenRes = await res.json()
      if (!res.ok || tokenRes.error) {
        fastify.log.error({ tokenRes }, 'Google token exchange failed')
        return reply.redirect(`${FRONTEND_URL}/login?error=google_token_failed`)
      }
    } catch (e) {
      fastify.log.error(e, 'Google token exchange error')
      return reply.redirect(`${FRONTEND_URL}/login?error=google_auth_error`)
    }

    // Fetch user profile from Google
    let profile: any
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenRes.access_token}` },
      })
      profile = await res.json()
      if (!profile.email) throw new Error('No email in profile')
    } catch (e) {
      fastify.log.error(e, 'Google userinfo fetch failed')
      return reply.redirect(`${FRONTEND_URL}/login?error=google_profile_failed`)
    }

    const { email, name, picture } = profile

    // Upsert user in database
    let user = await prisma.user.findUnique({ where: { email } })
    if (user) {
      user = await prisma.user.update({ where: { email }, data: { name, picture } })
    } else {
      const userId = `user_${uuidv4().replace(/-/g, '').slice(0, 12)}`
      user = await prisma.user.create({
        data: { user_id: userId, email, name, picture, role: 'user' },
      })
    }

    // Create session
    const sessionToken = createJwtToken(user.user_id)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await prisma.userSession.upsert({
      where:  { session_token: sessionToken },
      update: { expires_at: expiresAt },
      create: { user_id: user.user_id, session_token: sessionToken, expires_at: expiresAt },
    })

    reply.setCookie('session_token', sessionToken, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 })

    // Redirect to frontend — complete registration if new user
    const needsRegistration = !user.position || !user.facility
    const destination = needsRegistration ? '/complete-registration' : '/dashboard'
    return reply.redirect(`${FRONTEND_URL}${destination}`)
  })

  // ─── GET /api/auth/me ───────────────────────────────────────────────────────
  fastify.get('/auth/me', { preHandler: authenticate }, async (request, reply) => {
    return reply.send(userResponse((request as any).user))
  })

  // ─── POST /api/auth/complete-registration ──────────────────────────────────
  fastify.post('/auth/complete-registration', { preHandler: authenticate }, async (request, reply) => {
    const { phone_number, position, province, district, facility } = request.body as any
    if (!phone_number || !position || !province || !district || !facility) {
      return reply.code(400).send({ detail: 'All fields are required' })
    }

    const provinceNames = PROVINCES.map((p) => p.name)
    if (!provinceNames.includes(province)) return reply.code(400).send({ detail: 'Invalid province' })

    const hardcodedDistricts = DISTRICTS[province] || []
    const dbFacsDistricts = await prisma.facility.findMany({ where: { province }, select: { district: true } })
    const allDistricts = new Set([...hardcodedDistricts, ...dbFacsDistricts.map((f) => f.district)])
    if (!allDistricts.has(district)) return reply.code(400).send({ detail: 'Invalid district for selected province' })

    const hardcodedFacilities = FACILITIES_BY_DISTRICT[district] || []
    const dbFacs = await prisma.facility.findMany({ where: { district }, select: { name: true } })
    const allFacilities = new Set([...hardcodedFacilities, ...dbFacs.map((f) => f.name)])
    if (!allFacilities.has(facility)) return reply.code(400).send({ detail: 'Invalid facility for selected district' })

    if (!POSITIONS.includes(position)) return reply.code(400).send({ detail: 'Invalid position' })

    const userId = (request as any).user.user_id
    const updated = await prisma.user.update({
      where: { user_id: userId },
      data: { phone_number, position, province, district, facility },
    })

    return reply.send(userResponse(updated))
  })

  // ─── POST /api/auth/logout ──────────────────────────────────────────────────
  fastify.post('/auth/logout', async (request, reply) => {
    const token = (request.cookies as any)?.session_token
    if (token) {
      await prisma.userSession.deleteMany({ where: { session_token: token } })
    }
    reply.clearCookie('session_token', { path: '/' })
    return reply.send({ message: 'Logged out successfully' })
  })
}
