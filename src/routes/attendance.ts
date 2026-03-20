import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import prisma from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { checkAttendanceNotifications } from '../lib/notifications'

async function getShiftConfig() {
  let config = await prisma.shiftConfig.findUnique({ where: { config_id: 'default' } })
  if (!config) {
    config = await prisma.shiftConfig.create({ data: { config_id: 'default' } })
  }
  return config
}

export default async function attendanceRoutes(fastify: FastifyInstance) {
  // GET /api/shifts/available
  fastify.get('/shifts/available', { preHandler: authenticate }, async (request, reply) => {
    const config = await getShiftConfig()
    const user = (request as any).user

    const shifts: any[] = [
      { id: 'morning',   name: 'Morning',   start: config.morning_start,   end: config.morning_end },
      { id: 'afternoon', name: 'Afternoon', start: config.afternoon_start, end: config.afternoon_end },
      { id: 'night',     name: 'Night',     start: config.night_start,     end: config.night_end },
      { id: 'four_off',  name: 'Four Off',  start: config.four_off_start,  end: config.four_off_end },
      { id: 'on_call',   name: 'On Call',   start: config.on_call_start,   end: config.on_call_end },
    ]

    if (user.custom_shift_start && user.custom_shift_end) {
      shifts.push({
        id: 'custom',
        name: 'Custom',
        start: user.custom_shift_start,
        end: user.custom_shift_end,
      })
    }

    return reply.send({ shifts })
  })

  // POST /api/attendance
  fastify.post('/attendance', { preHandler: authenticate }, async (request, reply) => {
    const user = (request as any).user
    const body = request.body as any
    const { latitude, longitude, area_of_allocation, shift_type, offline_id } = body

    if (!user.facility || !user.position) {
      return reply.code(400).send({ detail: 'Please complete your registration first' })
    }

    // Determine action (login/logout)
    const lastRecord = await prisma.attendance.findFirst({
      where: { user_id: user.user_id },
      orderBy: { timestamp: 'desc' },
    })
    const action = !lastRecord || lastRecord.action === 'logout' ? 'login' : 'logout'

    // Idempotency for offline sync
    if (offline_id) {
      const existing = await prisma.attendance.findUnique({ where: { offline_id } })
      if (existing) {
        return reply.send({
          attendance_id: existing.attendance_id,
          action: existing.action,
          timestamp: existing.timestamp.toISOString(),
          message: 'Already synced',
        })
      }
    }

    const attendanceId = `att_${uuidv4().replace(/-/g, '').slice(0, 12)}`
    const now = new Date()

    const record = await prisma.attendance.create({
      data: {
        attendance_id: attendanceId,
        offline_id: offline_id || null,
        user_id: user.user_id,
        user_name: user.name,
        position: user.position,
        facility: user.facility,
        area_of_allocation: area_of_allocation || null,
        action,
        timestamp: now,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        shift_type: shift_type || 'morning',
        synced: true,
      },
    })

    // Fire notifications for login action
    if (action === 'login') {
      await checkAttendanceNotifications(user, {
        attendance_id: attendanceId,
        latitude,
        longitude,
        timestamp: now,
      }, area_of_allocation)
    }

    return reply.send({
      attendance_id: record.attendance_id,
      action: record.action,
      timestamp: record.timestamp.toISOString(),
      message: action === 'login' ? 'Reported for duty successfully' : 'Shift ended successfully',
    })
  })

  // POST /api/attendance/sync  (offline batch sync)
  fastify.post('/attendance/sync', { preHandler: authenticate }, async (request, reply) => {
    const user = (request as any).user
    const { records } = request.body as { records: any[] }

    if (!Array.isArray(records) || records.length === 0) {
      return reply.code(400).send({ detail: 'records array required' })
    }

    const results: any[] = []
    for (const rec of records) {
      const { latitude, longitude, area_of_allocation, shift_type, offline_id } = rec

      if (offline_id) {
        const existing = await prisma.attendance.findUnique({ where: { offline_id } })
        if (existing) {
          results.push({ offline_id, status: 'already_synced', attendance_id: existing.attendance_id })
          continue
        }
      }

      const lastRecord = await prisma.attendance.findFirst({
        where: { user_id: user.user_id },
        orderBy: { timestamp: 'desc' },
      })
      const action = !lastRecord || lastRecord.action === 'logout' ? 'login' : 'logout'
      const attendanceId = `att_${uuidv4().replace(/-/g, '').slice(0, 12)}`
      const ts = rec.timestamp ? new Date(rec.timestamp) : new Date()

      await prisma.attendance.create({
        data: {
          attendance_id: attendanceId,
          offline_id: offline_id || null,
          user_id: user.user_id,
          user_name: user.name,
          position: user.position || '',
          facility: user.facility || '',
          area_of_allocation: area_of_allocation || null,
          action,
          timestamp: ts,
          latitude: latitude ?? null,
          longitude: longitude ?? null,
          shift_type: shift_type || 'morning',
          synced: true,
        },
      })

      results.push({ offline_id, status: 'synced', attendance_id: attendanceId })
    }

    return reply.send({ synced: results.filter((r) => r.status === 'synced').length, results })
  })

  // GET /api/attendance/status
  fastify.get('/attendance/status', { preHandler: authenticate }, async (request, reply) => {
    const user = (request as any).user
    const last = await prisma.attendance.findFirst({
      where: { user_id: user.user_id },
      orderBy: { timestamp: 'desc' },
    })
    const isOnDuty = last?.action === 'login'
    return reply.send({
      is_on_duty: isOnDuty,
      last_action: last?.action ?? null,
      last_timestamp: last?.timestamp?.toISOString() ?? null,
    })
  })

  // GET /api/attendance/me
  fastify.get('/attendance/me', { preHandler: authenticate }, async (request, reply) => {
    const user = (request as any).user
    const query = request.query as any
    const limit = parseInt(query.limit || '50', 10)

    const records = await prisma.attendance.findMany({
      where: { user_id: user.user_id },
      orderBy: { timestamp: 'desc' },
      take: limit,
    })

    return reply.send({
      attendance: records.map((r) => ({
        attendance_id: r.attendance_id,
        action: r.action,
        timestamp: r.timestamp.toISOString(),
        facility: r.facility,
        area_of_allocation: r.area_of_allocation,
        shift_type: r.shift_type,
        latitude: r.latitude,
        longitude: r.longitude,
      })),
    })
  })
}
