/**
 * VChron User Report Routes
 *
 *   POST /api/reports/generate       — Generate + email encrypted PDF report to user
 *   GET  /api/reports/my             — List user's generated reports (download history)
 *   GET  /api/reports/download/:id   — Download a previously generated report (re-generate on-the-fly)
 */

import { FastifyInstance } from 'fastify'
import prisma from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { generateEncryptedReport } from '../lib/reportGenerator'
import { sendMail } from '../lib/mailer'
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays } from 'date-fns'

export default async function reportRoutes(fastify: FastifyInstance) {

  // ─── POST /api/reports/generate ──────────────────────────────────────────────
  fastify.post('/reports/generate', { preHandler: [authenticate] }, async (req, reply) => {
    const user = (req as any).user

    const {
      period_type = 'monthly',
      date_from: rawFrom,
      date_to: rawTo,
      send_email = true,
    } = req.body as {
      period_type?: string
      date_from?: string
      date_to?: string
      send_email?: boolean
    }

    // ── Resolve date range ──
    const now = new Date()
    let dateFrom: Date
    let dateTo: Date
    let periodLabel: string

    if (period_type === 'daily') {
      dateFrom = startOfDay(now)
      dateTo = endOfDay(now)
      periodLabel = format(now, 'dd MMMM yyyy')
    } else if (period_type === 'weekly') {
      dateFrom = startOfWeek(now, { weekStartsOn: 1 })
      dateTo = endOfWeek(now, { weekStartsOn: 1 })
      periodLabel = `Week of ${format(dateFrom, 'dd MMM')} – ${format(dateTo, 'dd MMM yyyy')}`
    } else if (period_type === 'monthly') {
      dateFrom = startOfMonth(now)
      dateTo = endOfMonth(now)
      periodLabel = format(now, 'MMMM yyyy')
    } else if (period_type === 'custom' && rawFrom && rawTo) {
      dateFrom = new Date(rawFrom)
      dateTo = new Date(rawTo)
      dateTo.setHours(23, 59, 59, 999)
      periodLabel = `${format(dateFrom, 'dd MMM')} – ${format(dateTo, 'dd MMM yyyy')}`
    } else {
      // Default: last 30 days
      dateFrom = startOfDay(subDays(now, 29))
      dateTo = endOfDay(now)
      periodLabel = `Last 30 Days`
    }

    // ── Fetch full user profile ──
    const fullUser = await prisma.user.findUnique({
      where: { user_id: user.user_id },
      select: {
        user_id: true,
        name: true,
        email: true,
        phone_number: true,
        position: true,
        facility: true,
      },
    })

    if (!fullUser) {
      return reply.code(404).send({ detail: 'User not found' })
    }

    if (!fullUser.phone_number) {
      return reply.code(400).send({ detail: 'No phone number on file. Cannot encrypt report. Please update your profile.' })
    }

    // ── Fetch attendance records ──
    const records = await prisma.attendance.findMany({
      where: {
        user_id: user.user_id,
        timestamp: { gte: dateFrom, lte: dateTo },
      },
      orderBy: { timestamp: 'asc' },
    })

    // ── Generate encrypted PDF ──
    const pdfBuffer = await generateEncryptedReport({
      user_name: fullUser.name,
      user_id: fullUser.user_id,
      email: fullUser.email,
      phone_number: fullUser.phone_number,
      position: fullUser.position || 'N/A',
      facility: fullUser.facility || 'N/A',
      period_label: periodLabel,
      period_type,
      date_from: dateFrom,
      date_to: dateTo,
      records: records.map(r => ({
        attendance_id: r.attendance_id,
        action: r.action,
        timestamp: r.timestamp,
        shift_type: r.shift_type,
        facility: r.facility,
        position: r.position,
        area_of_allocation: r.area_of_allocation,
      })),
    })

    // ── Save report record ──
    const reportRecord = await prisma.userReport.create({
      data: {
        user_id: fullUser.user_id,
        user_name: fullUser.name,
        period_label: periodLabel,
        period_type,
        date_from: dateFrom,
        date_to: dateTo,
        record_count: records.length,
        emailed: false,
      },
    })

    // ── Email report if requested ──
    if (send_email) {
      const passwordHint = fullUser.phone_number.replace(/\D/g, '')
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #0f766e; padding: 24px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">VChron</h1>
            <p style="color: #ccfbf1; margin: 4px 0 0; font-size: 12px;">Verified Workforce Intelligence</p>
          </div>
          <div style="padding: 24px; background: #f8fafc;">
            <h2 style="color: #1e293b;">Your Attendance Report is Ready</h2>
            <p style="color: #475569;">Hi <strong>${fullUser.name}</strong>,</p>
            <p style="color: #475569;">Your attendance report for <strong>${periodLabel}</strong> has been generated and is attached to this email.</p>
            <div style="background: #fef3c7; border-left: 4px solid #d97706; padding: 16px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0; color: #92400e; font-weight: bold;">🔒 This PDF is password protected</p>
              <p style="margin: 8px 0 0; color: #92400e;">Password: <strong>your registered phone number (digits only)</strong></p>
              <p style="margin: 4px 0 0; color: #92400e; font-size: 13px;">e.g. if your number is +260 972 827 372, the password is <code>260972827372</code></p>
            </div>
            <div style="background: white; border-radius: 8px; padding: 16px; margin: 20px 0; border: 1px solid #e2e8f0;">
              <p style="margin: 0; color: #64748b; font-size: 13px;"><strong>Report Summary</strong></p>
              <p style="margin: 8px 0 0; color: #1e293b;">Period: ${periodLabel}</p>
              <p style="margin: 4px 0 0; color: #1e293b;">Total Records: ${records.length}</p>
            </div>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">This report was generated on ${new Date().toLocaleString('en-ZM', { timeZone: 'Africa/Lusaka' })}. If you did not request this report, please contact your administrator.</p>
          </div>
          <div style="background: #0f766e; padding: 16px; text-align: center;">
            <p style="color: #ccfbf1; margin: 0; font-size: 11px;">VChron by GreenWebb Technologies | vchron@greenwebb.tech</p>
          </div>
        </div>
      `

      try {
        await sendMail({
          to: fullUser.email,
          subject: `VChron Attendance Report — ${periodLabel}`,
          html: emailHtml,
          attachments: [
            {
              filename: `VChron_Report_${fullUser.name.replace(/\s+/g, '_')}_${periodLabel.replace(/\s+/g, '_')}.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf',
            },
          ],
        })

        await prisma.userReport.update({
          where: { report_id: reportRecord.report_id },
          data: { emailed: true, emailed_at: new Date() },
        })
      } catch (emailErr) {
        console.error('Failed to send report email:', emailErr)
        // Don't fail the request — still return the PDF
      }
    }

    // ── Return PDF as download ──
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="VChron_Report_${periodLabel.replace(/\s+/g, '_')}.pdf"`)
      .header('X-Report-Id', reportRecord.report_id)
      .header('X-Record-Count', String(records.length))
      .send(pdfBuffer)
  })

  // ─── GET /api/reports/my ─────────────────────────────────────────────────────
  fastify.get('/reports/my', { preHandler: [authenticate] }, async (req, reply) => {
    const user = (req as any).user
    const { page = '1', limit = '20' } = req.query as { page?: string; limit?: string }

    const skip = (parseInt(page) - 1) * parseInt(limit)

    const [reports, total] = await Promise.all([
      prisma.userReport.findMany({
        where: { user_id: user.user_id },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
        select: {
          report_id: true,
          period_label: true,
          period_type: true,
          date_from: true,
          date_to: true,
          record_count: true,
          emailed: true,
          emailed_at: true,
          created_at: true,
        },
      }),
      prisma.userReport.count({ where: { user_id: user.user_id } }),
    ])

    return reply.send({ reports, total, page: parseInt(page), limit: parseInt(limit) })
  })

  // ─── GET /api/reports/download/:id ───────────────────────────────────────────
  // Re-generates the PDF on the fly using the stored date range
  fastify.get('/reports/download/:id', { preHandler: [authenticate] }, async (req, reply) => {
    const user = (req as any).user
    const { id } = req.params as { id: string }

    const report = await prisma.userReport.findFirst({
      where: { report_id: id, user_id: user.user_id },
    })

    if (!report) {
      return reply.code(404).send({ detail: 'Report not found' })
    }

    const fullUser = await prisma.user.findUnique({
      where: { user_id: user.user_id },
      select: { user_id: true, name: true, email: true, phone_number: true, position: true, facility: true },
    })

    if (!fullUser?.phone_number) {
      return reply.code(400).send({ detail: 'No phone number on file. Cannot decrypt report.' })
    }

    const records = await prisma.attendance.findMany({
      where: {
        user_id: user.user_id,
        timestamp: { gte: report.date_from, lte: report.date_to },
      },
      orderBy: { timestamp: 'asc' },
    })

    const pdfBuffer = await generateEncryptedReport({
      user_name: fullUser.name,
      user_id: fullUser.user_id,
      email: fullUser.email,
      phone_number: fullUser.phone_number,
      position: fullUser.position || 'N/A',
      facility: fullUser.facility || 'N/A',
      period_label: report.period_label,
      period_type: report.period_type,
      date_from: report.date_from,
      date_to: report.date_to,
      records: records.map(r => ({
        attendance_id: r.attendance_id,
        action: r.action,
        timestamp: r.timestamp,
        shift_type: r.shift_type,
        facility: r.facility,
        position: r.position,
        area_of_allocation: r.area_of_allocation,
      })),
    })

    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="VChron_Report_${report.period_label.replace(/\s+/g, '_')}.pdf"`)
      .send(pdfBuffer)
  })
}
