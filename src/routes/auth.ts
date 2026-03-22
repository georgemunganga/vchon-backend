/**
 * VChron Auth Routes
 *
 * ── User Auth (OTP-only, no password) ──────────────────────────────────────
 *   POST /api/auth/register/step1     — Validate name/email/phone, send OTP
 *   POST /api/auth/register/step2     — Verify OTP, mark verified, return setup_token
 *   POST /api/auth/register/step3     — Complete profile (ministry, org unit, position)
 *
 *   POST /api/auth/login/request-otp  — User requests OTP to log in (email or phone)
 *   POST /api/auth/login/verify-otp   — User submits OTP → returns access_token
 *
 * ── Staff Auth (password-based, Admin + Superuser only) ────────────────────
 *   POST /api/auth/staff/login        — Admin/Superuser login with email + password
 *
 * ── Shared ─────────────────────────────────────────────────────────────────
 *   GET  /api/auth/me
 *   POST /api/auth/logout
 *   GET  /api/auth/google
 *   GET  /api/auth/google/callback
 *   POST /api/auth/complete-registration  (Google OAuth users)
 */

import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import prisma from '../lib/prisma'
import {
  hashPassword, verifyPassword, createJwtToken, COOKIE_OPTIONS
} from '../lib/auth'
import { authenticate } from '../plugins/authenticate'
import { sendOtpEmail } from '../lib/mailer'

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI  || ''
const FRONTEND_URL         = process.env.FRONTEND_URL         || 'http://localhost:3000'

// ─── OTP Helpers ─────────────────────────────────────────────────────────────

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// ─── User Response Helper ─────────────────────────────────────────────────────

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
    is_verified:        u.is_verified        ?? false,
    setup_complete:     u.setup_complete     ?? false,
    ministry_id:        u.ministry_id        ?? null,
    org_unit_id:        u.org_unit_id        ?? null,
    created_at:         u.created_at?.toISOString() ?? null,
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export default async function authRoutes(fastify: FastifyInstance) {

  // ════════════════════════════════════════════════════════════════════════════
  // USER REGISTRATION WIZARD (OTP-only, no password)
  // ════════════════════════════════════════════════════════════════════════════

  // ─── STEP 1: Validate name/email/phone, send OTP ─────────────────────────────
  fastify.post('/auth/register/step1', async (request, reply) => {
    const { name, email, phone_number } = request.body as any

    if (!name || !email || !phone_number) {
      return reply.code(400).send({ detail: 'Name, email, and phone number are required' })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return reply.code(400).send({ detail: 'Invalid email address' })
    }

    // Block if already verified (existing account)
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing && existing.is_verified) {
      return reply.code(400).send({ detail: 'An account with this email already exists. Please sign in.' })
    }

    // Block if phone number is already taken by a different verified account
    const phoneOwner = await prisma.user.findFirst({
      where: { phone_number, is_verified: true },
    })
    if (phoneOwner && phoneOwner.email !== email) {
      return reply.code(400).send({ detail: 'This phone number is already registered to another account. Please use a different phone number.' })
    }

    const code = generateOtp()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    // Invalidate previous OTPs
    await prisma.otpCode.updateMany({
      where: { identifier: email, purpose: 'registration', used: false },
      data: { used: true },
    })

    await prisma.otpCode.create({
      data: { identifier: email, code, purpose: 'registration', expires_at: expiresAt },
    })

    await sendOtpEmail(email, code, name, 'registration')

    // Create or update a pending (unverified) user record — no password stored
    if (existing && !existing.is_verified) {
      await prisma.user.update({
        where: { email },
        data: { name, phone_number },
      })
    } else {
      const userId = `user_${uuidv4().replace(/-/g, '').slice(0, 12)}`
      await prisma.user.create({
        data: {
          user_id: userId,
          email,
          name,
          phone_number,
          role: 'user',
          is_verified: false,
          setup_complete: false,
        },
      })
    }

    return reply.send({
      message: 'OTP sent successfully',
      identifier: email,
      ...(process.env.NODE_ENV === 'development' ? { debug_otp: code } : {}),
    })
  })

  // ─── STEP 2: Verify OTP ───────────────────────────────────────────────────────
  fastify.post('/auth/register/step2', async (request, reply) => {
    const { email, code } = request.body as any

    if (!email || !code) {
      return reply.code(400).send({ detail: 'Email and OTP code are required' })
    }

    const otp = await prisma.otpCode.findFirst({
      where: {
        identifier: email,
        purpose: 'registration',
        used: false,
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: 'desc' },
    })

    if (!otp) {
      return reply.code(400).send({ detail: 'Invalid or expired OTP. Please request a new code.' })
    }
    if (otp.code !== code) {
      return reply.code(400).send({ detail: 'Incorrect OTP code' })
    }

    await prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } })

    const user = await prisma.user.update({
      where: { email },
      data: { is_verified: true },
    })

    const setupToken = createJwtToken(user.user_id)

    return reply.send({
      message: 'Email verified successfully',
      setup_token: setupToken,
      user_id: user.user_id,
    })
  })

  // ─── STEP 3: Complete profile setup ──────────────────────────────────────────
  fastify.post('/auth/register/step3', { preHandler: authenticate }, async (request, reply) => {
    const { ministry_id, org_unit_id, position } = request.body as any

    if (!ministry_id || !org_unit_id || !position) {
      return reply.code(400).send({ detail: 'Ministry, organisation unit, and position are required' })
    }

    const ministry = await prisma.ministry.findUnique({ where: { id: parseInt(ministry_id) } })
    if (!ministry) return reply.code(400).send({ detail: 'Invalid ministry' })

    const orgUnit = await prisma.orgUnit.findFirst({
      where: { id: parseInt(org_unit_id), ministry_id: parseInt(ministry_id) },
      include: { district: { include: { province: true } } },
    })
    if (!orgUnit) return reply.code(400).send({ detail: 'Invalid organisation unit for selected ministry' })

    const userId = (request as any).user.user_id

    const updated = await prisma.user.update({
      where: { user_id: userId },
      data: {
        ministry_id: parseInt(ministry_id),
        org_unit_id: parseInt(org_unit_id),
        position,
        province: orgUnit.district.province.name,
        district: orgUnit.district.name,
        facility: orgUnit.name,
        setup_complete: true,
      },
    })

    const token = createJwtToken(userId)
    reply.setCookie('session_token', token, COOKIE_OPTIONS)

    return reply.send({
      access_token: token,
      token_type: 'bearer',
      user: userResponse(updated),
    })
  })

  // ════════════════════════════════════════════════════════════════════════════
  // USER LOGIN (OTP-only — for role: 'user')
  // ════════════════════════════════════════════════════════════════════════════

  // ─── REQUEST OTP (login) ─────────────────────────────────────────────────────
  fastify.post('/auth/login/request-otp', async (request, reply) => {
    const { identifier } = request.body as any  // email or phone_number

    if (!identifier) {
      return reply.code(400).send({ detail: 'Email or phone number is required' })
    }

    // Find user by email or phone
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { phone_number: identifier },
        ],
        role: 'user',  // OTP login only for regular users
      },
    })

    if (!user) {
      // Return generic message to prevent user enumeration
      return reply.send({ message: 'If an account exists, a code has been sent.' })
    }

    if (!user.is_verified) {
      return reply.code(403).send({ detail: 'Account not verified. Please complete registration first.' })
    }

    if (!user.setup_complete) {
      return reply.code(403).send({ detail: 'Account setup incomplete. Please complete registration.' })
    }

    const code = generateOtp()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    // Invalidate previous login OTPs
    await prisma.otpCode.updateMany({
      where: { identifier: user.email, purpose: 'login', used: false },
      data: { used: true },
    })

    await prisma.otpCode.create({
      data: { identifier: user.email, code, purpose: 'login', expires_at: expiresAt },
    })

    await sendOtpEmail(user.email, code, user.name, 'login')

    return reply.send({
      message: 'If an account exists, a code has been sent.',
      // Return masked email so frontend can show "Code sent to j***@gmail.com"
      masked_email: user.email.replace(/(.{1}).+(@.+)/, '$1***$2'),
      ...(process.env.NODE_ENV === 'development' ? { debug_otp: code } : {}),
    })
  })

  // ─── VERIFY LOGIN OTP ─────────────────────────────────────────────────────────
  fastify.post('/auth/login/verify-otp', async (request, reply) => {
    const { identifier, code } = request.body as any

    if (!identifier || !code) {
      return reply.code(400).send({ detail: 'Identifier and OTP code are required' })
    }

    // Find user
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { phone_number: identifier },
        ],
      },
    })

    if (!user) {
      return reply.code(401).send({ detail: 'Invalid code' })
    }

    const otp = await prisma.otpCode.findFirst({
      where: {
        identifier: user.email,
        purpose: 'login',
        used: false,
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: 'desc' },
    })

    if (!otp || otp.code !== code) {
      return reply.code(401).send({ detail: 'Invalid or expired code' })
    }

    await prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } })

    const token = createJwtToken(user.user_id)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await prisma.userSession.upsert({
      where:  { session_token: token },
      update: { expires_at: expiresAt },
      create: { user_id: user.user_id, session_token: token, expires_at: expiresAt },
    })

    reply.setCookie('session_token', token, COOKIE_OPTIONS)

    return reply.send({
      access_token: token,
      token_type: 'bearer',
      user: userResponse(user),
    })
  })

  // ════════════════════════════════════════════════════════════════════════════
  // STAFF LOGIN (password-based — Admin + Superuser only)
  // ════════════════════════════════════════════════════════════════════════════

  fastify.post('/auth/staff/login', async (request, reply) => {
    const { email, password } = request.body as any
    if (!email || !password) {
      return reply.code(400).send({ detail: 'Email and password are required' })
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return reply.code(401).send({ detail: 'Invalid email or password' })
    }

    // Only admin and superuser can use password login
    if (user.role !== 'admin' && user.role !== 'superuser') {
      return reply.code(403).send({
        detail: 'This login is for staff only. Please use the employee login page.',
      })
    }

    if (!user.password) {
      return reply.code(401).send({ detail: 'Password not set for this account. Contact your administrator.' })
    }

    if (!verifyPassword(password, user.password)) {
      return reply.code(401).send({ detail: 'Invalid email or password' })
    }

    const token = createJwtToken(user.user_id)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await prisma.userSession.upsert({
      where:  { session_token: token },
      update: { expires_at: expiresAt },
      create: { user_id: user.user_id, session_token: token, expires_at: expiresAt },
    })

    reply.setCookie('session_token', token, COOKIE_OPTIONS)
    return reply.send({ access_token: token, token_type: 'bearer', user: userResponse(user) })
  })

  // ════════════════════════════════════════════════════════════════════════════
  // GOOGLE OAUTH
  // ════════════════════════════════════════════════════════════════════════════

  fastify.get('/auth/google', async (request, reply) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
      return reply.code(500).send({ detail: 'Google OAuth not configured.' })
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

  fastify.get('/auth/google/callback', async (request, reply) => {
    const { code, error } = request.query as any
    if (error || !code) {
      return reply.redirect(`${FRONTEND_URL}/login?error=google_auth_failed`)
    }

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
        return reply.redirect(`${FRONTEND_URL}/login?error=google_token_failed`)
      }
    } catch (e) {
      return reply.redirect(`${FRONTEND_URL}/login?error=google_auth_error`)
    }

    let profile: any
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenRes.access_token}` },
      })
      profile = await res.json()
      if (!profile.email) throw new Error('No email in profile')
    } catch (e) {
      return reply.redirect(`${FRONTEND_URL}/login?error=google_profile_failed`)
    }

    const { email, name, picture } = profile

    let user = await prisma.user.findUnique({ where: { email } })
    if (user) {
      user = await prisma.user.update({ where: { email }, data: { name, picture } })
    } else {
      const userId = `user_${uuidv4().replace(/-/g, '').slice(0, 12)}`
      user = await prisma.user.create({
        data: {
          user_id: userId,
          email,
          name,
          picture,
          role: 'user',
          is_verified: true,
          setup_complete: false,
        },
      })
    }

    const sessionToken = createJwtToken(user.user_id)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await prisma.userSession.upsert({
      where:  { session_token: sessionToken },
      update: { expires_at: expiresAt },
      create: { user_id: user.user_id, session_token: sessionToken, expires_at: expiresAt },
    })

    reply.setCookie('session_token', sessionToken, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 })

    const needsSetup = !user.setup_complete
    const destination = needsSetup ? '/register?step=3' : '/dashboard'
    return reply.redirect(`${FRONTEND_URL}${destination}?token=${encodeURIComponent(sessionToken)}`)
  })

  // ════════════════════════════════════════════════════════════════════════════
  // SHARED
  // ════════════════════════════════════════════════════════════════════════════

  fastify.get('/auth/me', { preHandler: authenticate }, async (request, reply) => {
    return reply.send(userResponse((request as any).user))
  })

  fastify.post('/auth/complete-registration', { preHandler: authenticate }, async (request, reply) => {
    const { phone_number, ministry_id, org_unit_id, position } = request.body as any

    if (!ministry_id || !org_unit_id || !position) {
      return reply.code(400).send({ detail: 'Ministry, organisation unit, and position are required' })
    }

    const ministry = await prisma.ministry.findUnique({ where: { id: parseInt(ministry_id) } })
    if (!ministry) return reply.code(400).send({ detail: 'Invalid ministry' })

    const orgUnit = await prisma.orgUnit.findFirst({
      where: { id: parseInt(org_unit_id), ministry_id: parseInt(ministry_id) },
      include: { district: { include: { province: true } } },
    })
    if (!orgUnit) return reply.code(400).send({ detail: 'Invalid organisation unit' })

    const userId = (request as any).user.user_id
    const updated = await prisma.user.update({
      where: { user_id: userId },
      data: {
        phone_number: phone_number || undefined,
        ministry_id: parseInt(ministry_id),
        org_unit_id: parseInt(org_unit_id),
        position,
        province: orgUnit.district.province.name,
        district: orgUnit.district.name,
        facility: orgUnit.name,
        setup_complete: true,
      },
    })

    return reply.send(userResponse(updated))
  })

  fastify.post('/auth/logout', async (request, reply) => {
    const token = (request.cookies as any)?.session_token
    if (token) {
      await prisma.userSession.deleteMany({ where: { session_token: token } })
    }
    reply.clearCookie('session_token', { path: '/' })
    return reply.send({ message: 'Logged out successfully' })
  })
}
