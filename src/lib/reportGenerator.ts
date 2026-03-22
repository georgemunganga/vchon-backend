/**
 * VChron Report Generator
 *
 * Generates a branded, encrypted PDF attendance report for an employee.
 * Encryption password = user's phone number (digits only).
 *
 * Bugs fixed in this version:
 *  - Action labels now map "login" → "Report for Duty" and "logout" → "End Shift"
 *    (matching the actual values stored by the attendance route)
 *  - Summary stat boxes now count login/logout correctly
 *  - Footer is drawn on the LAST page only, after all rows are written
 *  - Page overflow threshold accounts for footer height (120px safety margin)
 *  - No-data state renders a clear message with the selected period info
 *  - Extra blank pages eliminated by not calling addPage() unnecessarily
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

// ─── Human-readable action labels ────────────────────────────────────────────
const ACTION_LABEL: Record<string, string> = {
  login:        'Report for Duty',
  logout:       'End Shift',
  check_in:     'Check In',
  check_out:    'Check Out',
  report_duty:  'Report for Duty',
  lunch_out:    'Lunch Out',
  lunch_in:     'Lunch In',
}

function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ─── Build raw PDF buffer ─────────────────────────────────────────────────────
function buildPdfBuffer(opts: ReportOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const PAGE_WIDTH  = 595.28  // A4 points
    const PAGE_HEIGHT = 841.89
    const MARGIN      = 50
    const CONTENT_W   = PAGE_WIDTH - MARGIN * 2
    const FOOTER_H    = 55
    const SAFE_BOTTOM = PAGE_HEIGHT - FOOTER_H - 20  // stop adding rows before footer zone

    const doc = new PDFDocument({ margin: MARGIN, size: 'A4', autoFirstPage: true })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end',  () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // ── Colour palette ──
    const TEAL       = '#0f766e'
    const TEAL_LIGHT = '#ccfbf1'
    const DARK       = '#1e293b'
    const SLATE      = '#64748b'
    const LIGHT_BG   = '#f8fafc'
    const ROW_ALT    = '#f1f5f9'
    const WHITE      = '#ffffff'
    const AMBER_BG   = '#fef3c7'
    const AMBER_TEXT = '#92400e'

    // ── Helper: draw page header ──
    const drawHeader = () => {
      // Teal banner
      doc.rect(0, 0, PAGE_WIDTH, 88).fill(TEAL)

      // Logo / brand left
      doc.fillColor(WHITE).fontSize(24).font('Helvetica-Bold').text('VChron', MARGIN, 18)
      doc.fontSize(9).font('Helvetica').text('Verified Workforce Intelligence', MARGIN, 48)
      doc.fontSize(8).text('A GreenWebb Product', MARGIN, 62)

      // Report title right
      doc.fontSize(13).font('Helvetica-Bold')
        .text('ATTENDANCE REPORT', 0, 26, { align: 'right', width: PAGE_WIDTH - MARGIN })
      doc.fontSize(8).font('Helvetica')
        .text(
          `Generated: ${new Date().toLocaleString('en-ZM', { timeZone: 'Africa/Lusaka' })}`,
          0, 46, { align: 'right', width: PAGE_WIDTH - MARGIN }
        )

      doc.fillColor(DARK)
    }

    // ── Helper: draw footer on current page ──
    const drawFooter = () => {
      const fy = PAGE_HEIGHT - FOOTER_H
      doc.rect(0, fy, PAGE_WIDTH, FOOTER_H).fill(TEAL)
      doc.fillColor(WHITE).fontSize(7).font('Helvetica')
      doc.text(
        'This report is confidential and encrypted. Password: your registered phone number (digits only).',
        MARGIN, fy + 10, { align: 'center', width: CONTENT_W }
      )
      doc.text(
        'VChron by GreenWebb Technologies  |  vchron@greenwebb.tech',
        MARGIN, fy + 23, { align: 'center', width: CONTENT_W }
      )
      const reportId = randomBytes(4).toString('hex').toUpperCase()
      doc.text(
        `Report ID: ${reportId}  |  Generated for ${opts.user_name}`,
        MARGIN, fy + 36, { align: 'center', width: CONTENT_W }
      )
    }

    // ── Helper: draw table header row ──
    const drawTableHeader = (y: number): number => {
      doc.rect(MARGIN, y, CONTENT_W, 22).fill(DARK)
      doc.fillColor(WHITE).fontSize(8).font('Helvetica-Bold')
      doc.text('#',           MARGIN + 6,   y + 7)
      doc.text('Date',        MARGIN + 22,  y + 7)
      doc.text('Time',        MARGIN + 110, y + 7)
      doc.text('Action',      MARGIN + 175, y + 7)
      doc.text('Shift',       MARGIN + 295, y + 7)
      doc.text('Location',    MARGIN + 370, y + 7)
      return y + 22
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PAGE 1
    // ═══════════════════════════════════════════════════════════════════════════
    drawHeader()
    let y = 100

    // ── Employee info box ──
    doc.rect(MARGIN, y, CONTENT_W, 95).fill(LIGHT_BG)
    doc.rect(MARGIN, y, CONTENT_W, 95).stroke('#e2e8f0')

    doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold')
      .text('Employee Information', MARGIN + 14, y + 10)

    doc.fontSize(9).font('Helvetica')

    // Left column
    const lx = MARGIN + 14
    const lv = MARGIN + 100
    doc.fillColor(SLATE).text('Name:',       lx, y + 28).fillColor(DARK).text(opts.user_name,         lv, y + 28)
    doc.fillColor(SLATE).text('Employee ID:',lx, y + 42).fillColor(DARK).text(opts.user_id,           lv, y + 42)
    doc.fillColor(SLATE).text('Position:',   lx, y + 56).fillColor(DARK).text(opts.position || 'N/A', lv, y + 56)
    doc.fillColor(SLATE).text('Facility:',   lx, y + 70).fillColor(DARK).text(opts.facility || 'N/A', lv, y + 70)

    // Right column
    const rx  = MARGIN + 290
    const rv  = MARGIN + 340
    doc.fillColor(SLATE).text('Period:',        rx, y + 28).fillColor(DARK).text(opts.period_label,                                rv, y + 28)
    doc.fillColor(SLATE).text('From:',          rx, y + 42).fillColor(DARK).text(opts.date_from.toLocaleDateString('en-ZM'),       rv, y + 42)
    doc.fillColor(SLATE).text('To:',            rx, y + 56).fillColor(DARK).text(opts.date_to.toLocaleDateString('en-ZM'),         rv, y + 56)
    doc.fillColor(SLATE).text('Total Records:', rx, y + 70).fillColor(DARK).text(String(opts.records.length),                      rv, y + 70)

    y += 110

    // ── Summary stat boxes ──
    const logins   = opts.records.filter(r => r.action === 'login'   || r.action === 'check_in'  || r.action === 'report_duty').length
    const logouts  = opts.records.filter(r => r.action === 'logout'  || r.action === 'check_out').length
    const lunchOut = opts.records.filter(r => r.action === 'lunch_out').length
    const lunchIn  = opts.records.filter(r => r.action === 'lunch_in').length

    const BOX_W = (CONTENT_W - 30) / 4
    const statBoxes = [
      { label: 'Reports for Duty', value: logins,   color: '#0d9488' },
      { label: 'Shifts Ended',     value: logouts,  color: '#1d4ed8' },
      { label: 'Lunch Outs',       value: lunchOut, color: '#d97706' },
      { label: 'Lunch Ins',        value: lunchIn,  color: '#7c3aed' },
    ]
    statBoxes.forEach((box, i) => {
      const bx = MARGIN + i * (BOX_W + 10)
      doc.rect(bx, y, BOX_W, 52).fill(box.color)
      doc.fillColor(WHITE).fontSize(22).font('Helvetica-Bold')
        .text(String(box.value), bx, y + 7, { width: BOX_W, align: 'center' })
      doc.fontSize(7.5).font('Helvetica')
        .text(box.label, bx, y + 34, { width: BOX_W, align: 'center' })
    })

    y += 68

    // ── No-data state ──
    if (opts.records.length === 0) {
      // Amber notice box
      doc.rect(MARGIN, y, CONTENT_W, 80).fill(AMBER_BG)
      doc.rect(MARGIN, y, 4, 80).fill('#d97706')

      doc.fillColor(AMBER_TEXT).fontSize(11).font('Helvetica-Bold')
        .text('No Attendance Records Found', MARGIN + 18, y + 14)
      doc.fontSize(9).font('Helvetica')
        .text(
          `There are no check-in or check-out records for the selected period:`,
          MARGIN + 18, y + 32
        )
      doc.fontSize(9).font('Helvetica-Bold')
        .text(
          `${opts.period_label}  (${opts.date_from.toLocaleDateString('en-ZM')} – ${opts.date_to.toLocaleDateString('en-ZM')})`,
          MARGIN + 18, y + 46
        )
      doc.fontSize(8.5).font('Helvetica').fillColor(SLATE)
        .text(
          'If you believe this is incorrect, please contact your administrator.',
          MARGIN + 18, y + 62
        )

      y += 100

      drawFooter()
      doc.end()
      return
    }

    // ── Table ──
    y = drawTableHeader(y)

    opts.records.forEach((rec, idx) => {
      // Need a new page?
      if (y > SAFE_BOTTOM) {
        drawFooter()
        doc.addPage()
        drawHeader()
        y = 100
        y = drawTableHeader(y)
      }

      const rowBg = idx % 2 === 0 ? WHITE : ROW_ALT
      doc.rect(MARGIN, y, CONTENT_W, 18).fill(rowBg)
      doc.fillColor(DARK).fontSize(7.5).font('Helvetica')

      const ts      = new Date(rec.timestamp)
      const dateStr = ts.toLocaleDateString('en-ZM', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Lusaka' })
      const timeStr = ts.toLocaleTimeString('en-ZM', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Lusaka' })
      const shiftStr = rec.shift_type
        ? rec.shift_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        : '—'
      const locStr = rec.area_of_allocation || rec.facility || '—'
      const locDisplay = locStr.length > 22 ? locStr.slice(0, 19) + '…' : locStr

      doc.text(String(idx + 1),        MARGIN + 6,   y + 5)
      doc.text(dateStr,                MARGIN + 22,  y + 5)
      doc.text(timeStr,                MARGIN + 110, y + 5)
      doc.text(actionLabel(rec.action),MARGIN + 175, y + 5)
      doc.text(shiftStr,               MARGIN + 295, y + 5)
      doc.text(locDisplay,             MARGIN + 370, y + 5)

      y += 18
    })

    // ── Footer on last page ──
    drawFooter()
    doc.end()
  })
}

// ─── Encrypt PDF using qpdf (via node-qpdf2) ─────────────────────────────────
async function encryptPdf(pdfBuffer: Buffer, password: string): Promise<Buffer> {
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
  // Password = digits only from phone number (e.g. "+260 97 282 7372" → "260972827372")
  const password = (opts.phone_number || '000000').replace(/\D/g, '')
  const rawPdf   = await buildPdfBuffer(opts)
  const encrypted = await encryptPdf(rawPdf, password)
  return encrypted
}
