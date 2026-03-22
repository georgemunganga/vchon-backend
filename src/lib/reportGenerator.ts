/**
 * VChron Report Generator
 *
 * Generates a branded, encrypted PDF attendance report for an employee.
 * Encryption password = user's phone number (digits only).
 *
 * Steps:
 *  1. Build PDF with PDFKit (in-memory buffer)
 *  2. Write to a temp file
 *  3. Encrypt with qpdf via node-qpdf2 (returns encrypted Buffer)
 *  4. Clean up temp file and return encrypted buffer
 */

import PDFDocument from 'pdfkit'
import { encrypt } from 'node-qpdf2'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'

export interface AttendanceRecord {
  attendance_id: string
  action: string
  timestamp: Date
  shift_type?: string | null
  facility: string
  position: string
  area_of_allocation?: string | null
}

export interface ReportOptions {
  user_name: string
  user_id: string
  email: string
  phone_number: string
  position: string
  facility: string
  period_label: string
  period_type: string
  date_from: Date
  date_to: Date
  records: AttendanceRecord[]
}

// ─── Build raw PDF buffer ─────────────────────────────────────────────────────
function buildPdfBuffer(opts: ReportOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const teal = '#0f766e'
    const darkSlate = '#1e293b'
    const slate = '#64748b'
    const lightGray = '#f1f5f9'
    const white = '#ffffff'

    // ── Header banner ──
    doc.rect(0, 0, doc.page.width, 90).fill(teal)
    doc.fillColor(white).fontSize(26).font('Helvetica-Bold').text('VChron', 50, 22)
    doc.fontSize(10).font('Helvetica').text('Verified Workforce Intelligence', 50, 52)
    doc.fontSize(9).text('A GreenWebb Product', 50, 66)

    // Report title on the right
    doc.fontSize(12).font('Helvetica-Bold').text('ATTENDANCE REPORT', 0, 30, { align: 'right', width: doc.page.width - 50 })
    doc.fontSize(9).font('Helvetica').text(`Generated: ${new Date().toLocaleString('en-ZM', { timeZone: 'Africa/Lusaka' })}`, 0, 48, { align: 'right', width: doc.page.width - 50 })

    doc.fillColor(darkSlate)
    let y = 110

    // ── Employee info box ──
    doc.rect(50, y, doc.page.width - 100, 90).fill(lightGray).stroke()
    doc.fillColor(darkSlate).fontSize(11).font('Helvetica-Bold').text('Employee Information', 65, y + 10)
    doc.fontSize(9).font('Helvetica')
    doc.fillColor(slate).text('Name:', 65, y + 28).fillColor(darkSlate).text(opts.user_name, 130, y + 28)
    doc.fillColor(slate).text('Employee ID:', 65, y + 42).fillColor(darkSlate).text(opts.user_id, 130, y + 42)
    doc.fillColor(slate).text('Position:', 65, y + 56).fillColor(darkSlate).text(opts.position || 'N/A', 130, y + 56)
    doc.fillColor(slate).text('Facility:', 65, y + 70).fillColor(darkSlate).text(opts.facility || 'N/A', 130, y + 70)

    // Right column
    doc.fillColor(slate).text('Period:', 320, y + 28).fillColor(darkSlate).text(opts.period_label, 375, y + 28)
    doc.fillColor(slate).text('From:', 320, y + 42).fillColor(darkSlate).text(opts.date_from.toLocaleDateString('en-ZM'), 375, y + 42)
    doc.fillColor(slate).text('To:', 320, y + 56).fillColor(darkSlate).text(opts.date_to.toLocaleDateString('en-ZM'), 375, y + 56)
    doc.fillColor(slate).text('Total Records:', 320, y + 70).fillColor(darkSlate).text(String(opts.records.length), 410, y + 70)

    y += 110

    // ── Summary stats ──
    const checkIns = opts.records.filter(r => r.action === 'check_in' || r.action === 'report_duty').length
    const checkOuts = opts.records.filter(r => r.action === 'check_out').length
    const lunchOuts = opts.records.filter(r => r.action === 'lunch_out').length
    const lunchIns = opts.records.filter(r => r.action === 'lunch_in').length

    const boxW = (doc.page.width - 120) / 4
    const statBoxes = [
      { label: 'Check-Ins', value: checkIns, color: '#0d9488' },
      { label: 'Check-Outs', value: checkOuts, color: '#1d4ed8' },
      { label: 'Lunch Outs', value: lunchOuts, color: '#d97706' },
      { label: 'Lunch Ins', value: lunchIns, color: '#7c3aed' },
    ]
    statBoxes.forEach((box, i) => {
      const bx = 50 + i * (boxW + 10)
      doc.rect(bx, y, boxW, 50).fill(box.color)
      doc.fillColor(white).fontSize(20).font('Helvetica-Bold').text(String(box.value), bx, y + 8, { width: boxW, align: 'center' })
      doc.fontSize(8).font('Helvetica').text(box.label, bx, y + 32, { width: boxW, align: 'center' })
    })

    y += 70

    // ── Table header ──
    doc.rect(50, y, doc.page.width - 100, 22).fill(darkSlate)
    doc.fillColor(white).fontSize(8).font('Helvetica-Bold')
    doc.text('#', 58, y + 7)
    doc.text('Date & Time', 75, y + 7)
    doc.text('Action', 220, y + 7)
    doc.text('Shift', 310, y + 7)
    doc.text('Facility', 370, y + 7)

    y += 22

    // ── Table rows ──
    opts.records.forEach((rec, idx) => {
      if (y > doc.page.height - 80) {
        doc.addPage()
        y = 50
        // Repeat header on new page
        doc.rect(50, y, doc.page.width - 100, 22).fill(darkSlate)
        doc.fillColor(white).fontSize(8).font('Helvetica-Bold')
        doc.text('#', 58, y + 7)
        doc.text('Date & Time', 75, y + 7)
        doc.text('Action', 220, y + 7)
        doc.text('Shift', 310, y + 7)
        doc.text('Facility', 370, y + 7)
        y += 22
      }

      const rowBg = idx % 2 === 0 ? white : lightGray
      doc.rect(50, y, doc.page.width - 100, 18).fill(rowBg)
      doc.fillColor(darkSlate).fontSize(7.5).font('Helvetica')

      const ts = new Date(rec.timestamp)
      const dateStr = ts.toLocaleDateString('en-ZM', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Lusaka' })
      const timeStr = ts.toLocaleTimeString('en-ZM', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Lusaka' })

      const actionLabel: Record<string, string> = {
        check_in: 'Check In',
        report_duty: 'Report for Duty',
        check_out: 'Check Out',
        lunch_out: 'Lunch Out',
        lunch_in: 'Lunch In',
      }

      doc.text(String(idx + 1), 58, y + 5)
      doc.text(`${dateStr} ${timeStr}`, 75, y + 5)
      doc.text(actionLabel[rec.action] || rec.action, 220, y + 5)
      doc.text(rec.shift_type ? rec.shift_type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—', 310, y + 5)
      doc.text(rec.facility.length > 25 ? rec.facility.slice(0, 22) + '…' : rec.facility, 370, y + 5)

      y += 18
    })

    if (opts.records.length === 0) {
      doc.fillColor(slate).fontSize(10).font('Helvetica').text('No attendance records found for this period.', 50, y + 20, { align: 'center', width: doc.page.width - 100 })
      y += 40
    }

    // ── Footer ──
    const footerY = doc.page.height - 50
    doc.rect(0, footerY, doc.page.width, 50).fill(teal)
    doc.fillColor(white).fontSize(7).font('Helvetica')
    doc.text('This report is confidential and encrypted. Password: your registered phone number.', 50, footerY + 10, { align: 'center', width: doc.page.width - 100 })
    doc.text('VChron by GreenWebb Technologies | vchron@greenwebb.tech', 50, footerY + 22, { align: 'center', width: doc.page.width - 100 })
    doc.text(`Report ID: ${randomBytes(4).toString('hex').toUpperCase()} | Generated for ${opts.user_name}`, 50, footerY + 34, { align: 'center', width: doc.page.width - 100 })

    doc.end()
  })
}

// ─── Encrypt PDF using qpdf (via node-qpdf2) ─────────────────────────────────
async function encryptPdf(pdfBuffer: Buffer, password: string): Promise<Buffer> {
  // Write raw PDF to a temp file (qpdf requires file input)
  const tmpIn = join(tmpdir(), `vcron-report-${randomBytes(8).toString('hex')}.pdf`)
  try {
    writeFileSync(tmpIn, pdfBuffer)
    const encryptedBuffer = await encrypt({
      input: tmpIn,
      password: { user: password, owner: `vcron-owner-${password}` },
      keyLength: 256,
      restrictions: {
        print: 'low',
        modify: 'none',
        extract: 'n',
        annotate: 'n',
        assemble: 'n',
        accessibility: 'y',
      },
    })
    return encryptedBuffer
  } finally {
    if (existsSync(tmpIn)) {
      try { unlinkSync(tmpIn) } catch { /* ignore cleanup errors */ }
    }
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function generateEncryptedReport(opts: ReportOptions): Promise<Buffer> {
  // Password = digits only from phone number (e.g. "+260972827372" → "260972827372")
  const password = (opts.phone_number || '000000').replace(/\D/g, '')
  const rawPdf = await buildPdfBuffer(opts)
  const encrypted = await encryptPdf(rawPdf, password)
  return encrypted
}
