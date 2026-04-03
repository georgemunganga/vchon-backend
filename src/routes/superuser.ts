import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import ExcelJS from 'exceljs'
import prisma from '../lib/prisma'
import { requireSuperuser, requireAdmin } from '../plugins/authenticate'
import { hashPassword } from '../lib/auth'
import { PROVINCES, DISTRICTS, FACILITIES_BY_DISTRICT } from '../lib/constants'
import { auditLog, AUDIT_ACTIONS, actorFromRequest } from '../lib/audit'

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatLateDisplay(totalMinutes: number): string {
  return formatDuration(totalMinutes * 60)
}

function parseTimeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

export default async function superuserRoutes(fastify: FastifyInstance) {
  // GET /api/superuser/stats
  fastify.get('/superuser/stats', { preHandler: requireSuperuser }, async (_req, reply) => {
    const today = new Date(); today.setHours(0, 0, 0, 0)

    // Users currently on duty (clocked in today, no logout after)
    const onDutyRaw = await prisma.$queryRaw<{ user_id: string }[]>`
      SELECT DISTINCT a.user_id FROM "Attendance" a
      WHERE a.action = 'login'
        AND a.timestamp >= ${today}
        AND NOT EXISTS (
          SELECT 1 FROM "Attendance" b
          WHERE b.user_id = a.user_id AND b.action = 'logout' AND b.timestamp > a.timestamp
        )
    `

    const config = await prisma.shiftConfig.findUnique({ where: { config_id: 'default' } })

    // Helper: classify a login record
    function classifyLogin(ts: Date, shiftType: string | null): 'early' | 'on_time' | 'late' {
      if (!config || !shiftType) return 'on_time'
      const shiftStartStr = (config as any)[`${shiftType}_start`]
      if (!shiftStartStr) return 'on_time'
      const shiftStartMins = parseTimeToMinutes(shiftStartStr)
      const grace = config.grace_period_minutes || 15
      const recordMins = ts.getHours() * 60 + ts.getMinutes()
      const recordSecs = ts.getHours() * 3600 + ts.getMinutes() * 60 + ts.getSeconds()
      const shiftStartSecs = shiftStartMins * 60
      const graceSecs = grace * 60
      if (recordMins < shiftStartMins) return 'early'
      if (recordSecs <= shiftStartSecs + graceSecs) return 'on_time'
      return 'late'
    }

    // Today's login records for late/on-time/early breakdown
    const todayLogins = await prisma.attendance.findMany({
      where: { action: 'login', timestamp: { gte: today } },
      select: { timestamp: true, shift_type: true },
    })
    let todayLate = 0, todayOnTime = 0, todayEarly = 0
    for (const r of todayLogins) {
      const c = classifyLogin(r.timestamp, r.shift_type)
      if (c === 'late') todayLate++
      else if (c === 'early') todayEarly++
      else todayOnTime++
    }

    // All-time login records for overall late/on-time/early totals
    const allLogins = await prisma.attendance.findMany({
      where: { action: 'login' },
      select: { timestamp: true, shift_type: true },
    })
    let allLate = 0, allOnTime = 0, allEarly = 0
    for (const r of allLogins) {
      const c = classifyLogin(r.timestamp, r.shift_type)
      if (c === 'late') allLate++
      else if (c === 'early') allEarly++
      else allOnTime++
    }

    const [totalUsers, totalAdmins, totalSuperusers, totalFacilities, todayAttendance, totalAttendance] = await Promise.all([
      prisma.user.count({ where: { role: 'user' } }),
      prisma.user.count({ where: { role: 'admin' } }),
      prisma.user.count({ where: { role: 'superuser' } }),
      prisma.orgUnit.count(),
      prisma.attendance.count({ where: { timestamp: { gte: today } } }),
      prisma.attendance.count(),
    ])

    return reply.send({
      total_users: totalUsers,
      total_admins: totalAdmins,
      total_superusers: totalSuperusers,
      total_facilities: totalFacilities,
      today_logins: todayAttendance,
      currently_on_duty: onDutyRaw.length,
      today_attendance: todayAttendance,
      total_attendance: totalAttendance,
      today_late: todayLate,
      today_on_time: todayOnTime,
      today_early: todayEarly,
      all_late: allLate,
      all_on_time: allOnTime,
      all_early: allEarly,
    })
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
    const target = await prisma.user.findUnique({ where: { user_id: userId }, select: { name: true, email: true } })
    await prisma.user.delete({ where: { user_id: userId } })
    await auditLog({
      actor: actorFromRequest(request),
      action: AUDIT_ACTIONS.DELETE_USER,
      targetType: 'User',
      targetId: userId,
      metadata: { deleted_name: target?.name, deleted_email: target?.email },
    })
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
    await auditLog({
      actor: actorFromRequest(request),
      action: role === 'admin' ? AUDIT_ACTIONS.ASSIGN_ADMIN : AUDIT_ACTIONS.UPDATE_USER,
      targetType: 'User',
      targetId: userId,
      metadata: { new_role: role },
    })
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
    await auditLog({
      actor: actorFromRequest(request),
      action: AUDIT_ACTIONS.UPDATE_ADMIN_SCOPE,
      targetType: 'User',
      targetId: userId,
      metadata: { jurisdiction_type: type, jurisdiction_value: value },
    })
    return reply.send({ user_id: updated.user_id, assigned_jurisdiction: updated.assigned_jurisdiction })
  })

  // GET /api/superuser/facilities  (backed by OrgUnit — the canonical facility store)
  fastify.get('/superuser/facilities', { preHandler: requireSuperuser }, async (request, reply) => {
    const { search, district_id, ministry_id: minId } = (request.query as any)
    const where: any = {}
    if (search) where.name = { contains: search, mode: 'insensitive' }
    if (district_id) where.district_id = parseInt(district_id)
    if (minId) where.ministry_id = parseInt(minId)
    const units = await prisma.orgUnit.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        district: { include: { province: true } },
        ministry: { select: { name: true } },
        _count: { select: { users: true } },
      },
    })
    const facilities = units.map(u => ({
      id: u.id,
      name: u.name,
      district: u.district?.name ?? null,
      province: u.district?.province?.name ?? null,
      ministry: u.ministry?.name ?? null,
      staff_count: u._count.users,
      latitude: u.latitude,
      longitude: u.longitude,
    }))
    return reply.send({ facilities, total: facilities.length })
  })

  // POST /api/superuser/facilities — create a new OrgUnit
  fastify.post('/superuser/facilities', { preHandler: requireSuperuser }, async (request, reply) => {
    const { name, district_id, ministry_id: minId, latitude, longitude } = request.body as any
    if (!name || !district_id) return reply.code(400).send({ detail: 'name and district_id are required' })
    const unit = await prisma.orgUnit.create({
      data: {
        name,
        district_id: parseInt(district_id),
        ministry_id: minId ? parseInt(minId) : null,
        latitude: latitude !== undefined ? latitude : null,
        longitude: longitude !== undefined ? longitude : null,
      },
    })
    await auditLog({
      actor: actorFromRequest(request),
      action: AUDIT_ACTIONS.CREATE_ORG_UNIT,
      targetType: 'OrgUnit',
      targetId: String(unit.id),
      metadata: { name: unit.name },
    })
    return reply.code(201).send(unit)
  })

  // DELETE /api/superuser/facilities/:facilityId — delete an OrgUnit
  fastify.delete('/superuser/facilities/:facilityId', { preHandler: requireSuperuser }, async (request, reply) => {
    const { facilityId } = request.params as any
    const id = parseInt(facilityId)
    const target = await prisma.orgUnit.findUnique({ where: { id }, select: { name: true, _count: { select: { users: true } } } }).catch(() => null)
    if (!target) return reply.code(404).send({ detail: 'Facility not found' })
    if (target._count.users > 0) return reply.code(400).send({ detail: `Cannot delete: ${target._count.users} staff assigned to this facility` })
    await prisma.orgUnit.delete({ where: { id } })
    await auditLog({
      actor: actorFromRequest(request),
      action: AUDIT_ACTIONS.DELETE_ORG_UNIT,
      targetType: 'OrgUnit',
      targetId: facilityId,
      metadata: { deleted_name: target.name },
    })
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
    const merged = [...new Set([...allDistricts, ...dbFacs.map((f: { district: string }) => f.district)])].sort()
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
    if (facility) {
      where.facility = facility
    } else if (district) {
      // Look up OrgUnit names for this district
      const distRecord = await prisma.district.findFirst({ where: { name: district } })
      if (distRecord) {
        const units = await prisma.orgUnit.findMany({ where: { district_id: distRecord.id }, select: { name: true } })
        const names = units.map((u: { name: string }) => u.name)
        if (names.length) where.facility = { in: names }
      }
    } else if (province) {
      // Look up all OrgUnit names under this province
      const provRecord = await prisma.province.findFirst({ where: { name: province } })
      if (provRecord) {
        const dists = await prisma.district.findMany({ where: { province_id: provRecord.id }, select: { id: true } })
        const distIds = dists.map((d: { id: number }) => d.id)
        const units = await prisma.orgUnit.findMany({ where: { district_id: { in: distIds } }, select: { name: true } })
        const names = units.map((u: { name: string }) => u.name)
        if (names.length) where.facility = { in: names }
      }
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
      let status: 'on_time' | 'late' | 'early' | 'logout' | null = null

      if (r.action === 'login') {
        if (config && r.shift_type) {
          const shiftStartStr = (config as any)[`${r.shift_type}_start`]
          if (shiftStartStr) {
            const shiftStartMins = parseTimeToMinutes(shiftStartStr)
            const grace = config.grace_period_minutes || 15
            const recordMins = r.timestamp.getHours() * 60 + r.timestamp.getMinutes()
            const recordSecs = r.timestamp.getHours() * 3600 + r.timestamp.getMinutes() * 60 + r.timestamp.getSeconds()
            const shiftStartSecs = shiftStartMins * 60
            const graceSecs = grace * 60
            if (recordMins < shiftStartMins) {
              status = 'early'
            } else if (recordSecs <= shiftStartSecs + graceSecs) {
              status = 'on_time'
            } else {
              status = 'late'
              const lateMins = Math.floor((recordSecs - shiftStartSecs - graceSecs) / 60)
              lateDisplay = formatLateDisplay(lateMins)
            }
          } else {
            status = 'on_time'
          }
        } else {
          status = 'on_time'
        }
      } else if (r.action === 'logout') {
        status = 'logout'
        if (config && r.shift_type) {
          const shiftEndStr = (config as any)[`${r.shift_type}_end`]
          if (shiftEndStr) {
            const shiftEndMins = parseTimeToMinutes(shiftEndStr)
            const recordMins = r.timestamp.getHours() * 60 + r.timestamp.getMinutes()
            const earlyMins = shiftEndMins - recordMins
            if (earlyMins > 0) earlyDisplay = formatLateDisplay(earlyMins)
          }
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
        status,
        late_display: lateDisplay,
        early_display: earlyDisplay,
      }
    })

    return reply.send({ records: enriched, total, page: parseInt(page), limit: parseInt(limit) })
  })

  // GET /api/superuser/export  (Excel with color coding)
  fastify.get('/superuser/export', { preHandler: requireSuperuser }, async (request, reply) => {
    const query = request.query as any
    const { province, district, facility, date } = query

    const where: any = {}
    if (facility) {
      where.facility = facility
    } else if (district) {
      const distRecord = await prisma.district.findFirst({ where: { name: district } })
      if (distRecord) {
        const units = await prisma.orgUnit.findMany({ where: { district_id: distRecord.id }, select: { name: true } })
        const names = units.map((u: { name: string }) => u.name)
        if (names.length) where.facility = { in: names }
      }
    } else if (province) {
      const provRecord = await prisma.province.findFirst({ where: { name: province } })
      if (provRecord) {
        const dists = await prisma.district.findMany({ where: { province_id: provRecord.id }, select: { id: true } })
        const distIds = dists.map((d: { id: number }) => d.id)
        const units = await prisma.orgUnit.findMany({ where: { district_id: { in: distIds } }, select: { name: true } })
        const names = units.map((u: { name: string }) => u.name)
        if (names.length) where.facility = { in: names }
      }
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
    // Audit log the export
    await auditLog({
      actor: actorFromRequest(request),
      action: AUDIT_ACTIONS.EXPORT_ATTENDANCE_REPORT,
      targetType: 'Attendance',
      metadata: { province: province || 'all', district: district || 'all', facility: facility || 'all', date: date || 'all', record_count: records.length },
    })
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    reply.header('Content-Disposition', `attachment; filename="attendance_report.xlsx"`)
    return reply.send(Buffer.from(buffer))
  })

  // ─── GET /api/superuser/audit ─────────────────────────────────────────────────
  // Returns paginated audit logs with optional filters.
  // Accessible by superuser role only.
  fastify.get('/superuser/audit', { preHandler: requireSuperuser }, async (request, reply) => {
    const query = request.query as any
    const {
      page = '1',
      limit = '25',
      search,
      action,
      role,
      date_from,
      date_to,
    } = query

    const where: any = {}

    // Text search on actor name or actor_id
    if (search) {
      where.OR = [
        { actor_name: { contains: search, mode: 'insensitive' } },
        { actor_id:   { contains: search, mode: 'insensitive' } },
      ]
    }

    if (action) where.action = action
    if (role)   where.actor_role = role

    // Date range filter
    if (date_from || date_to) {
      where.created_at = {}
      if (date_from) {
        const from = new Date(date_from)
        from.setHours(0, 0, 0, 0)
        where.created_at.gte = from
      }
      if (date_to) {
        const to = new Date(date_to)
        to.setHours(23, 59, 59, 999)
        where.created_at.lte = to
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [logs, total] = await Promise.all([
      (prisma as any).auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      (prisma as any).auditLog.count({ where }),
    ])

    return reply.send({
      logs: logs.map((l: any) => ({
        id:          l.id,
        actor_id:    l.actor_id,
        actor_name:  l.actor_name,
        actor_role:  l.actor_role,
        action:      l.action,
        target_type: l.target_type,
        target_id:   l.target_id,
        metadata:    l.metadata,
        created_at:  l.created_at?.toISOString(),
      })),
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    })
  })

  // ─── GET /api/superuser/analytics ────────────────────────────────────────────
  // Returns attendance analytics with period, province/district/user filters.
  // Calculates early / on-time / late counts and percentages.
  fastify.get('/superuser/analytics', { preHandler: requireSuperuser }, async (request, reply) => {
    const query = request.query as any
    const { period, date_from, date_to, province, district, facility, user_id } = query

    // ── Date range ──────────────────────────────────────────────────────────
    const now = new Date()
    let start: Date
    let end: Date = new Date(now)
    end.setHours(23, 59, 59, 999)

    if (period === 'daily') {
      start = new Date(now); start.setHours(0, 0, 0, 0)
    } else if (period === 'weekly') {
      start = new Date(now)
      start.setDate(now.getDate() - now.getDay()) // Sunday
      start.setHours(0, 0, 0, 0)
    } else if (period === 'monthly') {
      start = new Date(now.getFullYear(), now.getMonth(), 1)
    } else if (date_from && date_to) {
      start = new Date(date_from); start.setHours(0, 0, 0, 0)
      end   = new Date(date_to);   end.setHours(23, 59, 59, 999)
    } else {
      // Default: today
      start = new Date(now); start.setHours(0, 0, 0, 0)
    }

    // ── Attendance filter ───────────────────────────────────────────────────
    const where: any = { timestamp: { gte: start, lte: end }, action: 'login' }
    if (user_id)  where.user_id  = user_id
    if (facility) {
      where.facility = facility
    } else if (district) {
      const distRecord = await prisma.district.findFirst({ where: { name: district } })
      if (distRecord) {
        const units = await prisma.orgUnit.findMany({ where: { district_id: distRecord.id }, select: { name: true } })
        const names = units.map((u: { name: string }) => u.name)
        if (names.length) where.facility = { in: names }
      }
    } else if (province) {
      const provRecord = await prisma.province.findFirst({ where: { name: province } })
      if (provRecord) {
        const dists = await prisma.district.findMany({ where: { province_id: provRecord.id }, select: { id: true } })
        const distIds = dists.map((d: { id: number }) => d.id)
        const units = await prisma.orgUnit.findMany({ where: { district_id: { in: distIds } }, select: { name: true } })
        const names = units.map((u: { name: string }) => u.name)
        if (names.length) where.facility = { in: names }
      }
    }

    const config = await prisma.shiftConfig.findUnique({ where: { config_id: 'default' } })
    const records = await prisma.attendance.findMany({ where, orderBy: { timestamp: 'asc' } })

    // ── Categorise each login record ────────────────────────────────────────
    let earlyCount = 0, onTimeCount = 0, lateCount = 0, unknownCount = 0
    const lateDetails: any[] = []

    for (const r of records) {
      if (!config || !r.shift_type) { unknownCount++; continue }
      const shiftStartStr = (config as any)[`${r.shift_type}_start`]
      if (!shiftStartStr) { unknownCount++; continue }

      const shiftStartMins = parseTimeToMinutes(shiftStartStr)
      const grace = config.grace_period_minutes || 15
      const recordMins = r.timestamp.getHours() * 60 + r.timestamp.getMinutes()
      const recordSecs = r.timestamp.getHours() * 3600 + r.timestamp.getMinutes() * 60 + r.timestamp.getSeconds()
      const shiftStartSecs = shiftStartMins * 60
      const graceSecs = grace * 60

      if (recordMins < shiftStartMins) {
        earlyCount++
      } else if (recordSecs <= shiftStartSecs + graceSecs) {
        onTimeCount++
      } else {
        lateCount++
        const diffSecs = recordSecs - (shiftStartSecs + graceSecs)
        lateDetails.push({
          user_id: r.user_id,
          user_name: r.user_name,
          facility: r.facility,
          shift_type: r.shift_type,
          timestamp: r.timestamp.toISOString(),
          late_by: formatDuration(diffSecs),
          late_seconds: diffSecs,
        })
      }
    }

    const total = records.length
    const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0

    // ── Daily breakdown for chart ───────────────────────────────────────────
    const dayMap: Record<string, { early: number; on_time: number; late: number }> = {}
    for (const r of records) {
      const day = r.timestamp.toISOString().split('T')[0]
      if (!dayMap[day]) dayMap[day] = { early: 0, on_time: 0, late: 0 }
      if (!config || !r.shift_type) continue
      const shiftStartStr = (config as any)[`${r.shift_type}_start`]
      if (!shiftStartStr) continue
      const shiftStartMins = parseTimeToMinutes(shiftStartStr)
      const grace = config.grace_period_minutes || 15
      const recordMins = r.timestamp.getHours() * 60 + r.timestamp.getMinutes()
      const recordSecs = r.timestamp.getHours() * 3600 + r.timestamp.getMinutes() * 60 + r.timestamp.getSeconds()
      const shiftStartSecs = shiftStartMins * 60
      const graceSecs = grace * 60
      if (recordMins < shiftStartMins) dayMap[day].early++
      else if (recordSecs <= shiftStartSecs + graceSecs) dayMap[day].on_time++
      else dayMap[day].late++
    }

    const daily_breakdown = Object.entries(dayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }))

    return reply.send({
      period: period || 'daily',
      date_from: start.toISOString(),
      date_to: end.toISOString(),
      total_logins: total,
      early: { count: earlyCount, percent: pct(earlyCount) },
      on_time: { count: onTimeCount, percent: pct(onTimeCount) },
      late: { count: lateCount, percent: pct(lateCount) },
      unknown: { count: unknownCount, percent: pct(unknownCount) },
      late_details: lateDetails.slice(0, 100),
      daily_breakdown,
    })
  })

  // ─── PUT /api/superuser/admins/:adminId/scope ─────────────────────────────
  // Assign or update an admin's ministry + geographic scope.
  // Scope shape: { ministry_id?, type: 'province'|'district'|'facility', value: string }
  fastify.put('/superuser/admins/:adminId/scope', { preHandler: requireSuperuser }, async (request, reply) => {
    const { adminId } = request.params as any
    const body = request.body as any
    const { ministry_id: raw_ministry_id, scope_type, scope_value } = body
    // ministry_id arrives as a string from JSON form fields — parse to Int
    const ministry_id = raw_ministry_id != null && raw_ministry_id !== ''
      ? parseInt(String(raw_ministry_id), 10)
      : undefined

    if (!scope_type || !['province', 'district', 'facility', 'national'].includes(scope_type)) {
      return reply.code(400).send({ detail: 'scope_type must be province, district, facility, or national' })
    }

    const admin = await prisma.user.findUnique({ where: { user_id: adminId } })
    if (!admin) return reply.code(404).send({ detail: 'Admin not found' })
    if (!['admin', 'superuser'].includes(admin.role)) {
      return reply.code(400).send({ detail: 'User is not an admin' })
    }

    const newJurisdiction = scope_type === 'national'
      ? { type: 'national', value: 'all' }
      : { type: scope_type, value: scope_value }

    const updated = await prisma.user.update({
      where: { user_id: adminId },
      data: {
        assigned_jurisdiction: newJurisdiction,
        ministry_id: ministry_id ?? undefined,
      },
    })

    await auditLog({
      actor: actorFromRequest(request),
      action: AUDIT_ACTIONS.UPDATE_ADMIN_SCOPE,
      targetType: 'User',
      targetId: adminId,
      metadata: { ministry_id, scope_type, scope_value, admin_name: admin.name },
    })

    return reply.send({
      user_id: updated.user_id,
      name: updated.name,
      assigned_jurisdiction: updated.assigned_jurisdiction,
      ministry_id: updated.ministry_id,
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // MINISTRY CRUD (Superuser only)
  // ─────────────────────────────────────────────────────────────────────────

  // GET /api/superuser/ministries
  fastify.get('/superuser/ministries', { preHandler: requireSuperuser }, async (_req, reply) => {
    const ministries = await prisma.ministry.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, unit_term: true, is_active: true, created_at: true },
    })
    return reply.send({ ministries })
  })

  // POST /api/superuser/ministries
  fastify.post('/superuser/ministries', { preHandler: requireSuperuser }, async (request, reply) => {
    const { name, unit_term = 'Facility', is_active = false } = request.body as any
    if (!name) return reply.code(400).send({ detail: 'Ministry name is required' })
    const existing = await prisma.ministry.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })
    if (existing) return reply.code(409).send({ detail: 'A ministry with this name already exists' })
    const ministry = await prisma.ministry.create({
      data: { name: name.trim(), unit_term: unit_term.trim(), is_active },
    })
    await auditLog({ actor: actorFromRequest(request), action: 'CREATE_MINISTRY', targetType: 'Ministry', targetId: String(ministry.id), metadata: { name: ministry.name } })
    return reply.code(201).send({ ministry })
  })

  // PATCH /api/superuser/ministries/:id
  fastify.patch('/superuser/ministries/:id', { preHandler: requireSuperuser }, async (request, reply) => {
    const { id } = request.params as any
    const { name, unit_term } = request.body as any
    const data: any = {}
    if (name !== undefined) data.name = name.trim()
    if (unit_term !== undefined) data.unit_term = unit_term.trim()
    if (!Object.keys(data).length) return reply.code(400).send({ detail: 'Nothing to update' })
    const ministry = await prisma.ministry.update({ where: { id: parseInt(id) }, data })
    return reply.send({ ministry })
  })

  // PATCH /api/superuser/ministries/:id/activate
  fastify.patch('/superuser/ministries/:id/activate', { preHandler: requireSuperuser }, async (request, reply) => {
    const { id } = request.params as any
    const ministry = await prisma.ministry.update({ where: { id: parseInt(id) }, data: { is_active: true } })
    await auditLog({ actor: actorFromRequest(request), action: 'ACTIVATE_MINISTRY', targetType: 'Ministry', targetId: String(ministry.id), metadata: { name: ministry.name } })
    return reply.send({ ministry })
  })

  // PATCH /api/superuser/ministries/:id/deactivate
  fastify.patch('/superuser/ministries/:id/deactivate', { preHandler: requireSuperuser }, async (request, reply) => {
    const { id } = request.params as any
    const ministry = await prisma.ministry.update({ where: { id: parseInt(id) }, data: { is_active: false } })
    await auditLog({ actor: actorFromRequest(request), action: 'DEACTIVATE_MINISTRY', targetType: 'Ministry', targetId: String(ministry.id), metadata: { name: ministry.name } })
    return reply.send({ ministry })
  })

  // DELETE /api/superuser/ministries/:id
  fastify.delete('/superuser/ministries/:id', { preHandler: requireSuperuser }, async (request, reply) => {
    const { id } = request.params as any
    const ministry = await prisma.ministry.findUnique({ where: { id: parseInt(id) } })
    if (!ministry) return reply.code(404).send({ detail: 'Ministry not found' })
    await prisma.ministry.delete({ where: { id: parseInt(id) } })
    await auditLog({ actor: actorFromRequest(request), action: 'DELETE_MINISTRY', targetType: 'Ministry', targetId: String(id), metadata: { name: ministry.name } })
    return reply.send({ message: 'Ministry deleted' })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // ORG STRUCTURE TREE
  // ─────────────────────────────────────────────────────────────────────────

  // GET /api/superuser/org-tree?ministry_id=X  — full province→district→facility→users tree
  fastify.get('/superuser/org-tree', { preHandler: requireSuperuser }, async (request, reply) => {
    const { ministry_id } = request.query as { ministry_id?: string }
    const orgWhere: any = ministry_id ? { ministry_id: parseInt(ministry_id) } : {}

    const [provinces, districts, orgUnits, users] = await Promise.all([
      prisma.province.findMany({ orderBy: { name: 'asc' } }),
      prisma.district.findMany({ orderBy: { name: 'asc' } }),
      prisma.orgUnit.findMany({ where: orgWhere, orderBy: { name: 'asc' } }),
      prisma.user.findMany({
        where: { role: 'user', setup_complete: true },
        select: { user_id: true, name: true, position: true, org_unit_id: true, assigned_shift: true, phone_number: true, email: true, created_at: true },
      }),
    ])

    const tree = provinces.map((prov: any) => {
      const provDistricts = districts
        .filter((d: any) => d.province_id === prov.id)
        .map((dist: any) => {
          const distUnits = orgUnits
            .filter((u: any) => u.district_id === dist.id)
            .map((unit: any) => ({
              id: unit.id, name: unit.name, type: unit.type,
              users: users.filter((u: any) => u.org_unit_id === unit.id)
                .map((u: any) => ({ user_id: u.user_id, name: u.name, position: u.position, assigned_shift: u.assigned_shift, phone: u.phone_number, email: u.email, created_at: u.created_at?.toISOString() })),
            }))
          return {
            id: dist.id, name: dist.name, org_units: distUnits,
            user_count: distUnits.reduce((s: number, u: any) => s + u.users.length, 0),
          }
        })
      return {
        id: prov.id, name: prov.name, districts: provDistricts,
        user_count: provDistricts.reduce((s: number, d: any) => s + d.user_count, 0),
      }
    })

    return reply.send({ tree })
  })

   // GET /api/admin/org-tree — admin sees their scoped tree (filtered by assigned_jurisdiction)
  fastify.get('/admin/org-tree', { preHandler: requireAdmin }, async (request, reply) => {
    const user = (request as any).user
    const jurisdiction = user.assigned_jurisdiction as { type: string; value: string } | null

    // Build province/district filters based on admin's jurisdiction scope
    let provinceWhere: any = {}
    let districtWhere: any = {}
    let orgUnitWhere: any = {}

    if (jurisdiction) {
      if (jurisdiction.type === 'province') {
        const prov = await prisma.province.findFirst({ where: { name: { contains: jurisdiction.value, mode: 'insensitive' } } })
        if (prov) {
          provinceWhere = { id: prov.id }
          districtWhere = { province_id: prov.id }
        }
      } else if (jurisdiction.type === 'district') {
        const dist = await prisma.district.findFirst({ where: { name: { contains: jurisdiction.value, mode: 'insensitive' } } })
        if (dist) {
          districtWhere = { id: dist.id }
          orgUnitWhere = { district_id: dist.id }
          // Get province for this district
          const prov = await prisma.province.findUnique({ where: { id: dist.province_id } })
          if (prov) provinceWhere = { id: prov.id }
        }
      } else if (jurisdiction.type === 'facility') {
        const unit = await prisma.orgUnit.findFirst({ where: { name: { contains: jurisdiction.value, mode: 'insensitive' } } })
        if (unit) {
          orgUnitWhere = { id: unit.id }
          const dist = await prisma.district.findUnique({ where: { id: unit.district_id } })
          if (dist) {
            districtWhere = { id: dist.id }
            const prov = await prisma.province.findUnique({ where: { id: dist.province_id } })
            if (prov) provinceWhere = { id: prov.id }
          }
        }
      }
    }

    const [provinces, districts, orgUnits, users] = await Promise.all([
      prisma.province.findMany({ where: provinceWhere, orderBy: { name: 'asc' } }),
      prisma.district.findMany({ where: districtWhere, orderBy: { name: 'asc' } }),
      prisma.orgUnit.findMany({ where: orgUnitWhere, orderBy: { name: 'asc' } }),
      prisma.user.findMany({
        where: { role: 'user' },
        select: { user_id: true, name: true, position: true, org_unit_id: true, assigned_shift: true, phone_number: true, email: true, created_at: true },
      }),
    ])
    const tree = provinces.map((prov: any) => {
      const provDistricts = districts
        .filter((d: any) => d.province_id === prov.id)
        .map((dist: any) => {
          const distUnits = orgUnits
            .filter((u: any) => u.district_id === dist.id)
            .map((unit: any) => ({
              id: unit.id, name: unit.name, type: unit.type,
              users: users.filter((u: any) => u.org_unit_id === unit.id)
                .map((u: any) => ({ user_id: u.user_id, name: u.name, position: u.position, assigned_shift: u.assigned_shift, phone: u.phone_number, email: u.email, created_at: u.created_at?.toISOString() })),
            }))
          return {
            id: dist.id, name: dist.name, org_units: distUnits,
            user_count: distUnits.reduce((s: number, u: any) => s + u.users.length, 0),
          }
        })
      return {
        id: prov.id, name: prov.name, districts: provDistricts,
        user_count: provDistricts.reduce((s: number, d: any) => s + d.user_count, 0),
      }
    })
    return reply.send({ tree })
  })
  // ─── GET /api/superuser/admins────────────────────────────────────────────
  // List all admin users with their current scope and ministry assignment.
  fastify.get('/superuser/admins', { preHandler: requireSuperuser }, async (_req, reply) => {
    const admins = await prisma.user.findMany({
      where: { role: { in: ['admin', 'superuser'] } },
      orderBy: { created_at: 'desc' },
    })

    // Fetch active ministries for the response
    const ministries = await (prisma as any).ministry.findMany({
      where: { is_active: true },
      select: { id: true, name: true, unit_term: true },
    }).catch(() => [])

    return reply.send({
      admins: admins.map((u: any) => ({
        user_id: u.user_id,
        name: u.name,
        email: u.email,
        role: u.role,
        ministry_id: u.ministry_id,
        ministry_name: ministries.find((m: any) => m.id === u.ministry_id)?.name || null,
        assigned_jurisdiction: u.assigned_jurisdiction,
        created_at: u.created_at?.toISOString(),
      })),
      ministries,
    })
  })

  // ─── Shift Tasks ──────────────────────────────────────────────────────────

  // GET /api/superuser/tasks/:attendanceId
  // Superuser views tasks for any attendance record globally
  fastify.get('/superuser/tasks/:attendanceId', { preHandler: requireSuperuser }, async (request, reply) => {
    const { attendanceId } = request.params as any

    const record = await prisma.shiftTask.findFirst({
      where: { attendance_id: attendanceId },
    })

    if (!record) {
      return reply.send({ tasks: [], has_tasks: false })
    }

    return reply.send({
      task_id: record.task_id,
      user_name: record.user_name,
      facility: record.facility,
      tasks: record.tasks,
      submitted_at: record.submitted_at.toISOString(),
      has_tasks: true,
    })
  })
}
