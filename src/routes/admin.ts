import { FastifyInstance } from 'fastify'
import ExcelJS from 'exceljs'
import prisma from '../lib/prisma'
import { requireAdmin } from '../plugins/authenticate'
import { getAdminScopeWhere } from '../lib/adminScope'

function formatLateDisplay(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
}

export default async function adminRoutes(fastify: FastifyInstance) {
  // GET /api/admin/attendance/realtime
  fastify.get('/admin/attendance/realtime', { preHandler: requireAdmin }, async (request, reply) => {
    const user = (request as any).user
    const scopeWhere = await getAdminScopeWhere(user)

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const records = await prisma.attendance.findMany({
      where: { ...scopeWhere, timestamp: { gte: today } },
      orderBy: { timestamp: 'desc' },
      take: 200,
    })

    return reply.send({
      attendance: records.map((r) => ({
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
      })),
    })
  })

  // GET /api/admin/users
  fastify.get('/admin/users', { preHandler: requireAdmin }, async (request, reply) => {
    const user = (request as any).user
    const scopeWhere = await getAdminScopeWhere(user)
    const query = request.query as any
    const { role, facility, search, page = '1', limit = '50' } = query

    const where: any = { ...scopeWhere }
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
        user_id: u.user_id,
        email: u.email,
        name: u.name,
        phone_number: u.phone_number,
        position: u.position,
        province: u.province,
        district: u.district,
        facility: u.facility,
        role: u.role,
        assigned_scope: u.assigned_scope,
        assigned_shift: u.assigned_shift,
        created_at: u.created_at?.toISOString(),
      })),
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    })
  })

  // PUT /api/admin/users/:userId
  fastify.put('/admin/users/:userId', { preHandler: requireAdmin }, async (request, reply) => {
    const { userId } = request.params as any
    const body = request.body as any
    const actingUser = (request as any).user

    const target = await prisma.user.findUnique({ where: { user_id: userId } })
    if (!target) return reply.code(404).send({ detail: 'User not found' })

    // Admins cannot promote to admin or superuser
    if (actingUser.role === 'admin' && body.role && ['admin', 'superuser'].includes(body.role)) {
      return reply.code(403).send({ detail: 'Only super users can create administrator accounts' })
    }

    const updated = await prisma.user.update({
      where: { user_id: userId },
      data: {
        name: body.name ?? undefined,
        phone_number: body.phone_number ?? undefined,
        position: body.position ?? undefined,
        province: body.province ?? undefined,
        district: body.district ?? undefined,
        facility: body.facility ?? undefined,
        role: body.role ?? undefined,
        assigned_scope: body.assigned_scope ?? undefined,
        assigned_shift: body.assigned_shift ?? undefined,
      },
    })

    return reply.send({
      user_id: updated.user_id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      facility: updated.facility,
      assigned_shift: updated.assigned_shift,
    })
  })

  // GET /api/admin/attendance
  fastify.get('/admin/attendance', { preHandler: requireAdmin }, async (request, reply) => {
    const user = (request as any).user
    const scopeWhere = await getAdminScopeWhere(user)
    const query = request.query as any
    const { facility, date, user_name, page = '1', limit = '50' } = query

    const where: any = { ...scopeWhere }
    if (facility) where.facility = facility
    if (user_name) where.user_name = { contains: user_name, mode: 'insensitive' }
    if (date) {
      const start = new Date(date)
      start.setHours(0, 0, 0, 0)
      const end = new Date(date)
      end.setHours(23, 59, 59, 999)
      where.timestamp = { gte: start, lte: end }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [records, total] = await Promise.all([
      prisma.attendance.findMany({ where, skip, take: parseInt(limit), orderBy: { timestamp: 'desc' } }),
      prisma.attendance.count({ where }),
    ])

    return reply.send({
      attendance: records.map((r) => ({
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
      })),
      total,
    })
  })

  // GET /api/admin/notifications
  fastify.get('/admin/notifications', { preHandler: requireAdmin }, async (request, reply) => {
    const user = (request as any).user
    const scopeWhere = await getAdminScopeWhere(user)
    const query = request.query as any
    const { unread_only, limit = '50' } = query

    const where: any = { ...scopeWhere }
    if (unread_only === 'true') where.read = false

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: parseInt(limit),
      }),
      prisma.notification.count({ where: { ...scopeWhere, read: false } }),
    ])

    return reply.send({
      notifications: notifications.map((n) => ({
        notification_id: n.notification_id,
        type: n.type,
        user_id: n.user_id,
        user_name: n.user_name,
        facility: n.facility,
        message: n.message,
        distance_meters: n.distance_meters,
        latitude: n.latitude,
        longitude: n.longitude,
        timestamp: n.timestamp.toISOString(),
        read: n.read,
        attendance_id: n.attendance_id,
      })),
      unread_count: unreadCount,
    })
  })

  // PUT /api/admin/notifications/:id/read
  fastify.put('/admin/notifications/:id/read', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as any
    await prisma.notification.update({ where: { notification_id: id }, data: { read: true } })
    return reply.send({ message: 'Notification marked as read' })
  })

  // PUT /api/admin/notifications/read-all
  fastify.put('/admin/notifications/read-all', { preHandler: requireAdmin }, async (request, reply) => {
    const user = (request as any).user
    const scopeWhere = await getAdminScopeWhere(user)
    await prisma.notification.updateMany({ where: scopeWhere, data: { read: true } })
    return reply.send({ message: 'All notifications marked as read' })
  })

  // GET /api/admin/shifts
  fastify.get('/admin/shifts', { preHandler: requireAdmin }, async (_req, reply) => {
    let config = await prisma.shiftConfig.findUnique({ where: { config_id: 'default' } })
    if (!config) config = await prisma.shiftConfig.create({ data: { config_id: 'default' } })
    return reply.send({ config })
  })

  // PUT /api/admin/users/:userId/shift
  fastify.put('/admin/users/:userId/shift', { preHandler: requireAdmin }, async (request, reply) => {
    const { userId } = request.params as any
    const { shift_type, custom_shift_start, custom_shift_end } = request.body as any

    const updated = await prisma.user.update({
      where: { user_id: userId },
      data: {
        assigned_shift: shift_type || null,
        custom_shift_start: custom_shift_start || null,
        custom_shift_end: custom_shift_end || null,
      },
    })

    return reply.send({ message: 'Shift assigned', user_id: updated.user_id, assigned_shift: updated.assigned_shift })
  })

  // GET /api/admin/export  (Excel)
  fastify.get('/admin/export', { preHandler: requireAdmin }, async (request, reply) => {
    const user = (request as any).user
    const scopeWhere = await getAdminScopeWhere(user)
    const query = request.query as any
    const { facility, date } = query

    const where: any = { ...scopeWhere }
    if (facility) where.facility = facility
    if (date) {
      const start = new Date(date); start.setHours(0, 0, 0, 0)
      const end = new Date(date); end.setHours(23, 59, 59, 999)
      where.timestamp = { gte: start, lte: end }
    }

    const records = await prisma.attendance.findMany({ where, orderBy: { timestamp: 'desc' } })
    const config = await prisma.shiftConfig.findUnique({ where: { config_id: 'default' } })

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Attendance')
    sheet.columns = [
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Position', key: 'position', width: 20 },
      { header: 'Facility', key: 'facility', width: 30 },
      { header: 'Action', key: 'action', width: 10 },
      { header: 'Timestamp', key: 'timestamp', width: 22 },
      { header: 'Shift', key: 'shift', width: 12 },
      { header: 'Status', key: 'status', width: 15 },
    ]

    for (const rec of records) {
      sheet.addRow({
        name: rec.user_name,
        position: rec.position,
        facility: rec.facility,
        action: rec.action,
        timestamp: rec.timestamp.toISOString(),
        shift: rec.shift_type || '',
        status: '',
      })
    }

    const buffer = await workbook.xlsx.writeBuffer()
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    reply.header('Content-Disposition', `attachment; filename="attendance_export.xlsx"`)
    return reply.send(Buffer.from(buffer))
  })

  // GET /api/admin/send-backup
  fastify.get('/admin/send-backup', { preHandler: requireAdmin }, async (request, reply) => {
    const RESEND_API_KEY = process.env.RESEND_API_KEY
    const BACKUP_EMAIL = process.env.BACKUP_EMAIL
    if (!RESEND_API_KEY || !BACKUP_EMAIL) {
      return reply.code(500).send({ detail: 'Email service not configured' })
    }

    const user = (request as any).user
    const scopeWhere = await getAdminScopeWhere(user)
    const query = request.query as any
    const { facility, date } = query

    const where: any = { ...scopeWhere }
    if (facility) where.facility = facility
    if (date) {
      const start = new Date(date); start.setHours(0, 0, 0, 0)
      const end = new Date(date); end.setHours(23, 59, 59, 999)
      where.timestamp = { gte: start, lte: end }
    }

    const records = await prisma.attendance.findMany({ where, orderBy: { timestamp: 'desc' } })
    const csvRows = ['Name,Position,Facility,Action,Timestamp,Shift']
    for (const r of records) {
      csvRows.push(`${r.user_name},${r.position},${r.facility},${r.action},${r.timestamp.toISOString()},${r.shift_type || ''}`)
    }
    const csvContent = csvRows.join('\n')

    try {
      const { Resend } = await import('resend')
      const resend = new Resend(RESEND_API_KEY)
      await resend.emails.send({
        from: process.env.SENDER_EMAIL || 'onboarding@resend.dev',
        to: BACKUP_EMAIL,
        subject: `V-Chron Attendance Backup - ${date || 'All'}`,
        text: `Attendance backup attached.\n\nRecords: ${records.length}`,
        attachments: [{ filename: 'attendance_backup.csv', content: Buffer.from(csvContent).toString('base64') }],
      })
      return reply.send({ message: 'Backup sent successfully' })
    } catch (err: any) {
      return reply.code(500).send({ detail: `Failed to send email: ${err.message}` })
    }
  })
}
