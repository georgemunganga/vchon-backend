import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import ExcelJS from 'exceljs'
import prisma from '../lib/prisma'
import { requireSuperuser } from '../plugins/authenticate'
import { hashPassword } from '../lib/auth'
import { PROVINCES, DISTRICTS, FACILITIES_BY_DISTRICT } from '../lib/constants'

function formatLateDisplay(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
}

function parseTimeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

export default async function superuserRoutes(fastify: FastifyInstance) {
  // GET /api/superuser/stats
  fastify.get('/superuser/stats', { preHandler: requireSuperuser }, async (_req, reply) => {
    const today = new Date(); today.setHours(0, 0, 0, 0)

    const [totalUsers, totalFacilities, todayAttendance, totalAttendance] = await Promise.all([
      prisma.user.count({ where: { role: 'user' } }),
      prisma.facility.count(),
      prisma.attendance.count({ where: { timestamp: { gte: today } } }),
      prisma.attendance.count(),
    ])

    return reply.send({ total_users: totalUsers, total_facilities: totalFacilities, today_attendance: todayAttendance, total_attendance: totalAttendance })
  })

  // GET /api/superuser/users
  fastify.get('/superuser/users', { preHandler: requireSuperuser }, async (request, reply) => {
    const query = request.query as any
    const { role, facility, search, page = '1', limit = '50' } = query

    const where: any = {}
    if (role) where.role = role
    if (facility) where.facility = facility
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ]
    }

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, skip, take: parseInt(limit), orderBy: { created_at: 'desc' } }),
      prisma.user.count({ where }),
    ])

    return reply.send({
      users: users.map((u) => ({
        user_id: u.user_id, email: u.email, name: u.name, phone_number: u.phone_number,
        position: u.position, province: u.province, district: u.district, facility: u.facility,
        role: u.role, assigned_scope: u.assigned_scope, assigned_shift: u.assigned_shift,
        assigned_jurisdiction: u.assigned_jurisdiction, created_at: u.created_at?.toISOString(),
      })),
      total, page: parseInt(page), limit: parseInt(limit),
    })
  })

  // DELETE /api/superuser/users/:userId
  fastify.delete('/superuser/users/:userId', { preHandler: requireSuperuser }, async (request, reply) => {
    const { userId } = request.params as any
    await prisma.user.delete({ where: { user_id: userId } })
    return reply.send({ message: 'User deleted' })
  })

  // PUT /api/superuser/users/:userId/role
  fastify.put('/superuser/users/:userId/role', { preHandler: requireSuperuser }, async (request, reply) => {
    const { userId } = request.params as any
    const { role } = request.body as any
    if (!['user', 'admin', 'superuser'].includes(role)) {
      return reply.code(400).send({ detail: 'Invalid role' })
    }
    const updated = await prisma.user.update({ where: { user_id: userId }, data: { role } })
    return reply.send({ user_id: updated.user_id, role: updated.role })
  })

  // PUT /api/superuser/users/:userId/reset-password
  fastify.put('/superuser/users/:userId/reset-password', { preHandler: requireSuperuser }, async (request, reply) => {
    const { userId } = request.params as any
    const { new_password } = request.body as any
    if (!new_password || new_password.length < 8) {
      return reply.code(400).send({ detail: 'Password must be at least 8 characters' })
    }
    await prisma.user.update({ where: { user_id: userId }, data: { password: hashPassword(new_password) } })
    return reply.send({ message: 'Password reset successfully' })
  })

  // PUT /api/superuser/users/:userId/jurisdiction
  fastify.put('/superuser/users/:userId/jurisdiction', { preHandler: requireSuperuser }, async (request, reply) => {
    const { userId } = request.params as any
    const { type, value } = request.body as any
    if (!['facility', 'district', 'province'].includes(type)) {
      return reply.code(400).send({ detail: 'type must be facility, district, or province' })
    }
    const updated = await prisma.user.update({
      where: { user_id: userId },
      data: { assigned_jurisdiction: { type, value } },
    })
    return reply.send({ user_id: updated.user_id, assigned_jurisdiction: updated.assigned_jurisdiction })
  })

  // GET /api/superuser/facilities
  fastify.get('/superuser/facilities', { preHandler: requireSuperuser }, async (_req, reply) => {
    const dbFacs = await prisma.facility.findMany({ orderBy: { name: 'asc' } })
    return reply.send({ facilities: dbFacs })
  })

  // POST /api/superuser/facilities
  fastify.post('/superuser/facilities', { preHandler: requireSuperuser }, async (request, reply) => {
    const { name, district, province, latitude, longitude } = request.body as any
    if (!name || !district || !province) return reply.code(400).send({ detail: 'name, district, province required' })

    const facilityId = `fac_${uuidv4().replace(/-/g, '').slice(0, 12)}`
    const facility = await prisma.facility.create({
      data: { facility_id: facilityId, name, district, province, latitude: latitude ?? null, longitude: longitude ?? null },
    })
    return reply.code(201).send(facility)
  })

  // DELETE /api/superuser/facilities/:facilityId
  fastify.delete('/superuser/facilities/:facilityId', { preHandler: requireSuperuser }, async (request, reply) => {
    const { facilityId } = request.params as any
    await prisma.facility.delete({ where: { facility_id: facilityId } })
    return reply.send({ message: 'Facility deleted' })
  })

  // GET /api/superuser/provinces
  fastify.get('/superuser/provinces', { preHandler: requireSuperuser }, async (_req, reply) => {
    return reply.send({ provinces: PROVINCES })
  })

  // GET /api/superuser/districts
  fastify.get('/superuser/districts', { preHandler: requireSuperuser }, async (_req, reply) => {
    const allDistricts: string[] = []
    for (const dists of Object.values(DISTRICTS)) allDistricts.push(...dists)
    const dbFacs = await prisma.facility.findMany({ select: { district: true } })
    const merged = [...new Set([...allDistricts, ...dbFacs.map((f) => f.district)])].sort()
    return reply.send({ districts: merged })
  })

  // GET /api/superuser/shifts
  fastify.get('/superuser/shifts', { preHandler: requireSuperuser }, async (_req, reply) => {
    let config = await prisma.shiftConfig.findUnique({ where: { config_id: 'default' } })
    if (!config) config = await prisma.shiftConfig.create({ data: { config_id: 'default' } })
    return reply.send({ config })
  })

  // PUT /api/superuser/shifts
  fastify.put('/superuser/shifts', { preHandler: requireSuperuser }, async (request, reply) => {
    const body = request.body as any
    const config = await prisma.shiftConfig.upsert({
      where: { config_id: 'default' },
      update: {
        morning_start: body.morning_start ?? undefined,
        morning_end: body.morning_end ?? undefined,
        afternoon_start: body.afternoon_start ?? undefined,
        afternoon_end: body.afternoon_end ?? undefined,
        night_start: body.night_start ?? undefined,
        night_end: body.night_end ?? undefined,
        four_off_start: body.four_off_start ?? undefined,
        four_off_end: body.four_off_end ?? undefined,
        on_call_start: body.on_call_start ?? undefined,
        on_call_end: body.on_call_end ?? undefined,
        grace_period_minutes: body.grace_period_minutes ?? undefined,
      },
      create: { config_id: 'default' },
    })
    return reply.send({ config })
  })

  // GET /api/superuser/attendance-report
  fastify.get('/superuser/attendance-report', { preHandler: requireSuperuser }, async (request, reply) => {
    const query = request.query as any
    const { province, district, facility, date, page = '1', limit = '100' } = query

    const where: any = {}
    if (facility) where.facility = facility
    else if (district) {
      const hardcoded = FACILITIES_BY_DISTRICT[district] || []
      const dbFacs = await prisma.facility.findMany({ where: { district }, select: { name: true } })
      const all = [...new Set([...hardcoded, ...dbFacs.map((f) => f.name)])]
      if (all.length) where.facility = { in: all }
    } else if (province) {
      const dists = DISTRICTS[province] || []
      let allFacs: string[] = []
      for (const d of dists) allFacs = allFacs.concat(FACILITIES_BY_DISTRICT[d] || [])
      const dbFacs = await prisma.facility.findMany({ where: { province }, select: { name: true } })
      allFacs = [...new Set([...allFacs, ...dbFacs.map((f) => f.name)])]
      if (allFacs.length) where.facility = { in: allFacs }
    }

    if (date) {
      const start = new Date(date); start.setHours(0, 0, 0, 0)
      const end = new Date(date); end.setHours(23, 59, 59, 999)
      where.timestamp = { gte: start, lte: end }
    }

    const config = await prisma.shiftConfig.findUnique({ where: { config_id: 'default' } })
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [records, total] = await Promise.all([
      prisma.attendance.findMany({ where, skip, take: parseInt(limit), orderBy: { timestamp: 'desc' } }),
      prisma.attendance.count({ where }),
    ])

    const enriched = records.map((r) => {
      let lateDisplay: string | null = null
      let earlyDisplay: string | null = null

      if (config && r.shift_type && r.action === 'login') {
        const shiftStartStr = (config as any)[`${r.shift_type}_start`]
        if (shiftStartStr) {
          const shiftStartMins = parseTimeToMinutes(shiftStartStr)
          const grace = config.grace_period_minutes || 15
          const recordMins = r.timestamp.getHours() * 60 + r.timestamp.getMinutes()
          const lateMins = recordMins - (shiftStartMins + grace)
          if (lateMins > 0) lateDisplay = formatLateDisplay(lateMins)
        }
      }

      if (config && r.shift_type && r.action === 'logout') {
        const shiftEndStr = (config as any)[`${r.shift_type}_end`]
        if (shiftEndStr) {
          const shiftEndMins = parseTimeToMinutes(shiftEndStr)
          const recordMins = r.timestamp.getHours() * 60 + r.timestamp.getMinutes()
          const earlyMins = shiftEndMins - recordMins
          if (earlyMins > 0) earlyDisplay = formatLateDisplay(earlyMins)
        }
      }

      return {
        attendance_id: r.attendance_id,
        user_id: r.user_id,
        user_name: r.user_name,
        position: r.position,
        facility: r.facility,
        area_of_allocation: r.area_of_allocation,
        action: r.action,
        timestamp: r.timestamp.toISOString(),
        shift_type: r.shift_type,
        latitude: r.latitude,
        longitude: r.longitude,
        late_display: lateDisplay,
        early_display: earlyDisplay,
      }
    })

    return reply.send({ attendance: enriched, total, page: parseInt(page), limit: parseInt(limit) })
  })

  // GET /api/superuser/export  (Excel with color coding)
  fastify.get('/superuser/export', { preHandler: requireSuperuser }, async (request, reply) => {
    const query = request.query as any
    const { province, district, facility, date } = query

    const where: any = {}
    if (facility) where.facility = facility
    else if (district) {
      const hardcoded = FACILITIES_BY_DISTRICT[district] || []
      const dbFacs = await prisma.facility.findMany({ where: { district }, select: { name: true } })
      const all = [...new Set([...hardcoded, ...dbFacs.map((f) => f.name)])]
      if (all.length) where.facility = { in: all }
    } else if (province) {
      const dists = DISTRICTS[province] || []
      let allFacs: string[] = []
      for (const d of dists) allFacs = allFacs.concat(FACILITIES_BY_DISTRICT[d] || [])
      const dbFacs = await prisma.facility.findMany({ where: { province }, select: { name: true } })
      allFacs = [...new Set([...allFacs, ...dbFacs.map((f) => f.name)])]
      if (allFacs.length) where.facility = { in: allFacs }
    }

    if (date) {
      const start = new Date(date); start.setHours(0, 0, 0, 0)
      const end = new Date(date); end.setHours(23, 59, 59, 999)
      where.timestamp = { gte: start, lte: end }
    }

    const config = await prisma.shiftConfig.findUnique({ where: { config_id: 'default' } })
    const records = await prisma.attendance.findMany({ where, orderBy: { timestamp: 'desc' } })

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Attendance Report')
    sheet.columns = [
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Position', key: 'position', width: 20 },
      { header: 'Facility', key: 'facility', width: 30 },
      { header: 'Action', key: 'action', width: 10 },
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Time', key: 'time', width: 10 },
      { header: 'Shift', key: 'shift', width: 12 },
      { header: 'Late By', key: 'late', width: 12 },
      { header: 'Early By', key: 'early', width: 12 },
    ]

    // Style header row
    sheet.getRow(1).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true }
    })

    for (const r of records) {
      let lateDisplay = ''
      let earlyDisplay = ''

      if (config && r.shift_type) {
        if (r.action === 'login') {
          const shiftStartStr = (config as any)[`${r.shift_type}_start`]
          if (shiftStartStr) {
            const shiftStartMins = parseTimeToMinutes(shiftStartStr)
            const grace = config.grace_period_minutes || 15
            const recordMins = r.timestamp.getHours() * 60 + r.timestamp.getMinutes()
            const lateMins = recordMins - (shiftStartMins + grace)
            if (lateMins > 0) lateDisplay = formatLateDisplay(lateMins)
          }
        }
        if (r.action === 'logout') {
          const shiftEndStr = (config as any)[`${r.shift_type}_end`]
          if (shiftEndStr) {
            const shiftEndMins = parseTimeToMinutes(shiftEndStr)
            const recordMins = r.timestamp.getHours() * 60 + r.timestamp.getMinutes()
            const earlyMins = shiftEndMins - recordMins
            if (earlyMins > 0) earlyDisplay = formatLateDisplay(earlyMins)
          }
        }
      }

      const row = sheet.addRow({
        name: r.user_name,
        position: r.position,
        facility: r.facility,
        action: r.action,
        date: r.timestamp.toISOString().split('T')[0],
        time: r.timestamp.toTimeString().slice(0, 5),
        shift: r.shift_type || '',
        late: lateDisplay,
        early: earlyDisplay,
      })

      if (lateDisplay) {
        row.getCell('late').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer()
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    reply.header('Content-Disposition', `attachment; filename="attendance_report.xlsx"`)
    return reply.send(Buffer.from(buffer))
  })
}
