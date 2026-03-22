/**
 * VChron Audit Logger
 *
 * Records all significant administrative and superuser actions to the AuditLog table.
 * This provides a tamper-evident trail of who did what and when.
 *
 * Usage:
 *   import { auditLog } from '../lib/audit'
 *   await auditLog({ actor, action: 'EXPORT_REPORT', targetType: 'Attendance', metadata: { filters } })
 */

import prisma from './prisma'

// ─── Action Constants ─────────────────────────────────────────────────────────

export const AUDIT_ACTIONS = {
  // Data exports & downloads
  EXPORT_ATTENDANCE_REPORT: 'EXPORT_ATTENDANCE_REPORT',
  EXPORT_USER_LIST:         'EXPORT_USER_LIST',
  DOWNLOAD_PDF:             'DOWNLOAD_PDF',
  DOWNLOAD_SPREADSHEET:     'DOWNLOAD_SPREADSHEET',

  // User management
  CREATE_USER:              'CREATE_USER',
  UPDATE_USER:              'UPDATE_USER',
  DELETE_USER:              'DELETE_USER',
  APPROVE_DELETION:         'APPROVE_DELETION',
  REJECT_DELETION:          'REJECT_DELETION',
  REQUEST_DELETION:         'REQUEST_DELETION',

  // Admin management (superuser only)
  ASSIGN_ADMIN:             'ASSIGN_ADMIN',
  REVOKE_ADMIN:             'REVOKE_ADMIN',
  UPDATE_ADMIN_SCOPE:       'UPDATE_ADMIN_SCOPE',

  // Ministry / org management (superuser only)
  CREATE_MINISTRY:          'CREATE_MINISTRY',
  UPDATE_MINISTRY:          'UPDATE_MINISTRY',
  ACTIVATE_MINISTRY:        'ACTIVATE_MINISTRY',
  DEACTIVATE_MINISTRY:      'DEACTIVATE_MINISTRY',
  CREATE_ORG_UNIT:          'CREATE_ORG_UNIT',
  UPDATE_ORG_UNIT:          'UPDATE_ORG_UNIT',
  DELETE_ORG_UNIT:          'DELETE_ORG_UNIT',

  // Shift config
  UPDATE_SHIFT_CONFIG:      'UPDATE_SHIFT_CONFIG',

  // Auth
  STAFF_LOGIN:              'STAFF_LOGIN',
  STAFF_LOGOUT:             'STAFF_LOGOUT',
} as const

export type AuditAction = typeof AUDIT_ACTIONS[keyof typeof AUDIT_ACTIONS]

// ─── Actor type ───────────────────────────────────────────────────────────────

export interface AuditActor {
  user_id:  string
  name:     string
  role:     string
}

// ─── Log function ─────────────────────────────────────────────────────────────

export async function auditLog(params: {
  actor:       AuditActor
  action:      string
  targetType?: string
  targetId?:   string
  metadata?:   Record<string, unknown>
}): Promise<void> {
  try {
    await (prisma as any).auditLog.create({
      data: {
        actor_id:    params.actor.user_id,
        actor_name:  params.actor.name,
        actor_role:  params.actor.role,
        action:      params.action,
        target_type: params.targetType ?? null,
        target_id:   params.targetId   ?? null,
        metadata:    params.metadata   ?? null,
      },
    })
  } catch (err) {
    // Audit logging must never crash the main request
    console.error('[Audit] Failed to write audit log:', err)
  }
}

// ─── Helper to extract actor from Fastify request ─────────────────────────────

export function actorFromRequest(request: any): AuditActor {
  const u = (request as any).user
  return {
    user_id: u?.user_id ?? 'unknown',
    name:    u?.name    ?? 'Unknown',
    role:    u?.role    ?? 'unknown',
  }
}
