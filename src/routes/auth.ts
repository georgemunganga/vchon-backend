/**
 * VChron Auth Routes
 *
 * Registration Wizard (3 steps):
 *   POST /api/auth/register/step1  — Validate credentials, send OTP
 *   POST /api/auth/register/step2  — Verify OTP, create unverified user
 *   POST /api/auth/register/step3  — Complete profile setup
 *
 * Standard Auth:
 *   POST /api/auth/login
 *   POST /api/auth/logout
 *   GET  /api/auth/me
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

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI  || ''
const FRONTEND_URL         = process.env.FRONTEND_URL         || 'http://localhost:3000'

// ─── OTP Helpers ─────────────────────────────────────────────────────────────

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

async function sendOtpEmail(email: string, code: string, name: string): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.log(`[OTP] Would send code ${code} to ${email} (RESEND_API_KEY not set)`)
    return
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'VChron <noreply@vcron.cloud>',
        to: [email],
        subject: 'Your VChron Verification Code',
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
            <h2 style="color: #0f766e;">Verify your VChron account</h2>
            <p>Hi ${name},</p>
            <p>Your verification code is:</p>
            <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #0f766e; padding: 16px; background: #f0fdf4; border-radius: 8px; text-align: center; margin: 16px 0;">
              ${code}
            </div>
            <p style="color: #6b7280;">This code expires in 10 minutes. Do not share it with anyone.</p>
            <p style="color: #6b7280; font-size: 12px;">If you did not request this, please ignore this email.</p>
          </div>
        `,
      }),
    })
    if (!res.ok) {
      const err = await res.json()
      console.error('[OTP] Resend error:', err)
    }
  } catch (e) {
    console.error('[OTP] Failed to send email:', e)
  }
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

  // ─── STEP 1: Validate credentials, send OTP ──────────────────────────────────
  fastify.post('/auth/register/step1', async (request, reply) => {
    const { name, email, phone_number, password } = request.body as any

    if (!name || !email || !phone_number || !password) {
      return reply.code(400).send({ detail: 'Name, email, phone number, and password are required' })
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return reply.code(400).send({ detail: 'Invalid email address' })
    }

    // Validate password strength
    if (password.length < 8) {
      return reply.code(400).send({ detail: 'Password must be at least 8 characters' })
    }

    // Check if email already registered and verified
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing && existing.is_verified) {
      return reply.code(400).send({ detail: 'Email already registered' })
    }

    // Generate OTP
    const code = generateOtp()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    // Invalidate any existing OTPs for this email
    await prisma.otpCode.updateMany({
      where: { identifier: email, purpose: 'registration', used: false },
      data: { used: true },
    })

    // Save new OTP
    await prisma.otpCode.create({
      data: { identifier: email, code, purpose: 'registration', expires_at: expiresAt },
    })

    // Send OTP email
    await sendOtpEmail(email, code, name)

    // Store pending registration data temporarily (we'll use it in step2)
    // We use a temp OTP record with metadata stored in a separate pending record
    // For simplicity, we store the hashed password in a temp user record
    if (existing && !existing.is_verified) {
      // Update the unverified user's pending data
      await prisma.user.update({
        where: { email },
        data: { name, phone_number, password: hashPassword(password) },
      })
    } else {
      // Create a placeholder unverified user
      const userId = `user_${uuidv4().replace(/-/g, '').slice(0, 12)}`
      await prisma.user.create({
        data: {
          user_id: userId,
          email,
          name,
          phone_number,
          password: hashPassword(password),
          role: 'user',
          is_verified: false,
          setup_complete: false,
        },
      })
    }

    return reply.send({
      message: 'OTP sent successfully',
      identifier: email,
      // In development, return the code for testing (remove in production)
      ...(process.env.NODE_ENV === 'development' ? { debug_otp: code } : {}),
    })
  })

  // ─── STEP 2: Verify OTP ───────────────────────────────────────────────────────
  fastify.post('/auth/register/step2', async (request, reply) => {
    const { email, code } = request.body as any

    if (!email || !code) {
      return reply.code(400).send({ detail: 'Email and OTP code are required' })
    }

    // Find the most recent unused OTP for this email
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

    // Mark OTP as used
    await prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } })

    // Mark user as verified
    const user = await prisma.user.update({
      where: { email },
      data: { is_verified: true },
    })

    // Issue a temporary setup token (short-lived)
    const setupToken = createJwtToken(user.user_id)

    return reply.send({
      message: 'Email verified successfully',
      setup_token: setupToken,
      user_id: user.user_id,
    })
  })

  // ─── STEP 3: Complete profile setup ──────────────────────────────────────────
  fastify.post('/auth/register/step3', { preHandler: authenticate }, async (request, reply) => {
    const { ministry_id, org_unit_id, position, province_id, district_id } = request.body as any

    if (!ministry_id || !org_unit_id || !position) {
      return reply.code(400).send({ detail: 'Ministry, organisation unit, and position are required' })
    }

    // Validate ministry exists
    const ministry = await prisma.ministry.findUnique({ where: { id: parseInt(ministry_id) } })
    if (!ministry) return reply.code(400).send({ detail: 'Invalid ministry' })

    // Validate org unit exists and belongs to the ministry
    const orgUnit = await prisma.orgUnit.findFirst({
      where: { id: parseInt(org_unit_id), ministry_id: parseInt(ministry_id) },
      include: {
        district: { include: { province: true } },
      },
    })
    if (!orgUnit) return reply.code(400).send({ detail: 'Invalid organisation unit for selected ministry' })

    const userId = (request as any).user.user_id

    // Update user with complete profile
    const updated = await prisma.user.update({
      where: { user_id: userId },
      data: {
        ministry_id: parseInt(ministry_id),
        org_unit_id: parseInt(org_unit_id),
        position,
        // Also populate legacy flat fields for backward compatibility
        province: orgUnit.district.province.name,
        district: orgUnit.district.name,
        facility: orgUnit.name,
        setup_complete: true,
      },
    })

    // Issue full auth token
    const token = createJwtToken(userId)
    reply.setCookie('session_token', token, COOKIE_OPTIONS)

    return reply.send({
      access_token: token,
      token_type: 'bearer',
      user: userResponse(updated),
    })
  })

  // ─── POST /api/auth/login ─────────────────────────────────────────────────────
  fastify.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body as any
    if (!email || !password) return reply.code(400).send({ detail: 'Email and password required' })

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) return reply.code(401).send({ detail: 'Invalid email or password' })
    if (!user.password) return reply.code(401).send({ detail: 'Please use Google sign-in for this account' })
    if (!verifyPassword(password, user.password)) return reply.code(401).send({ detail: 'Invalid email or password' })

    // If user is not verified, block login and prompt them to verify
    if (!user.is_verified) {
      return reply.code(403).send({ detail: 'Account not verified. Please complete registration.' })
    }

    const token = createJwtToken(user.user_id)
    reply.setCookie('session_token', token, COOKIE_OPTIONS)
    return reply.send({ access_token: token, token_type: 'bearer', user: userResponse(user) })
  })

  // ─── GET /api/auth/google ─────────────────────────────────────────────────────
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

  // ─── GET /api/auth/google/callback ───────────────────────────────────────────
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
          is_verified: true, // Google accounts are pre-verified
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

  // ─── GET /api/auth/me ─────────────────────────────────────────────────────────
  fastify.get('/auth/me', { preHandler: authenticate }, async (request, reply) => {
    return reply.send(userResponse((request as any).user))
  })

  // ─── POST /api/auth/complete-registration (Google OAuth users) ────────────────
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

  // ─── POST /api/auth/logout ────────────────────────────────────────────────────
  fastify.post('/auth/logout', async (request, reply) => {
    const token = (request.cookies as any)?.session_token
    if (token) {
      await prisma.userSession.deleteMany({ where: { session_token: token } })
    }
    reply.clearCookie('session_token', { path: '/' })
    return reply.send({ message: 'Logged out successfully' })
  })
}
