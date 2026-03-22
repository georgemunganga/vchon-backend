/**
 * VChron Mailer — Nodemailer with Hostinger SMTP (smtps / port 465)
 *
 * Environment variables expected:
 *   MAIL_HOST         smtp.hostinger.com
 *   MAIL_PORT         465
 *   MAIL_USERNAME     vchron@greenwebb.tech
 *   MAIL_PASSWORD     <password>
 *   MAIL_FROM_ADDRESS vchron@greenwebb.tech
 *   MAIL_FROM_NAME    VChron Notification
 *   MAIL_SCHEME       smtps   (triggers secure: true)
 */

import nodemailer from 'nodemailer'

const host     = process.env.MAIL_HOST         || 'smtp.hostinger.com'
const port     = parseInt(process.env.MAIL_PORT || '465', 10)
const user     = process.env.MAIL_USERNAME      || ''
const pass     = process.env.MAIL_PASSWORD      || ''
const fromAddr = process.env.MAIL_FROM_ADDRESS  || user
const fromName = process.env.MAIL_FROM_NAME     || 'VChron Notification'
const scheme   = process.env.MAIL_SCHEME        || 'smtps'

// smtps (port 465) uses implicit TLS — secure: true
// smtp  (port 587) uses STARTTLS  — secure: false
const secure = scheme === 'smtps' || port === 465

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: { user, pass },
  tls: {
    // Allow self-signed certs in dev; remove in strict prod if needed
    rejectUnauthorized: process.env.NODE_ENV === 'production',
  },
})

/**
 * Send a transactional email.
 */
export async function sendMail(options: {
  to: string
  subject: string
  html: string
  text?: string
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>
}): Promise<void> {
  if (!user || !pass) {
    console.warn('[Mailer] MAIL_USERNAME or MAIL_PASSWORD not set — email not sent.')
    console.log(`[Mailer] Would send to ${options.to}: ${options.subject}`)
    return
  }

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromAddr}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments?.map(a => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    })
    console.log(`[Mailer] Email sent to ${options.to} — messageId: ${info.messageId}`)
  } catch (err) {
    console.error('[Mailer] Failed to send email:', err)
    throw err
  }
}

/**
 * Send a 6-digit OTP email.
 */
export async function sendOtpEmail(
  email: string,
  code: string,
  name: string,
  purpose: 'registration' | 'login' = 'registration'
): Promise<void> {
  const subject = purpose === 'login'
    ? 'Your VChron Sign-In Code'
    : 'Verify Your VChron Account'

  const heading = purpose === 'login'
    ? 'Sign in to VChron'
    : 'Verify your VChron account'

  const bodyText = purpose === 'login'
    ? `Hi ${name},\n\nYour VChron sign-in code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.\n\nIf you did not request this, please ignore this email.`
    : `Hi ${name},\n\nYour VChron verification code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.\n\nIf you did not request this, please ignore this email.`

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 0;">
        <tr>
          <td align="center">
            <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
              <!-- Header -->
              <tr>
                <td style="background:#0f766e;padding:28px 32px;text-align:center;">
                  <span style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:1px;">VChron</span>
                  <br/>
                  <span style="color:#99f6e4;font-size:12px;">Verified Workforce Intelligence</span>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:32px;">
                  <h2 style="margin:0 0 8px;color:#0f766e;font-size:20px;">${heading}</h2>
                  <p style="color:#374151;margin:0 0 20px;">Hi <strong>${name}</strong>,</p>
                  <p style="color:#374151;margin:0 0 12px;">
                    ${purpose === 'login'
                      ? 'Use the code below to sign in to your VChron account:'
                      : 'Use the code below to verify your VChron account:'}
                  </p>
                  <!-- OTP Box -->
                  <div style="background:#f0fdf4;border:2px solid #6ee7b7;border-radius:10px;padding:20px;text-align:center;margin:20px 0;">
                    <span style="font-size:40px;font-weight:bold;letter-spacing:12px;color:#0f766e;">${code}</span>
                  </div>
                  <p style="color:#6b7280;font-size:13px;margin:0 0 8px;">
                    This code expires in <strong>10 minutes</strong>. Do not share it with anyone.
                  </p>
                  <p style="color:#9ca3af;font-size:12px;margin:0;">
                    If you did not request this, you can safely ignore this email.
                  </p>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background:#f1f5f9;padding:16px 32px;text-align:center;">
                  <p style="color:#94a3b8;font-size:11px;margin:0;">
                    &copy; ${new Date().getFullYear()} VChron by GreenWebb &middot; vchron@greenwebb.tech
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `

  await sendMail({ to: email, subject, html, text: bodyText })
}
