/**
 * VChron User Routes
 *
 *   POST /api/user/request-deletion          — User submits account deletion request
 *   GET  /api/user/deletion-request/status   — User checks their own request status
 *
 *   GET  /api/admin/deletion-requests        — Admin/Superuser lists all pending requests
 *   PUT  /api/admin/deletion-requests/:id/approve  — Admin approves → account deleted
 *   PUT  /api/admin/deletion-requests/:id/reject   — Admin rejects → request closed
 */

import { FastifyInstance } from 'fastify'
import prisma from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { auditLog } from '../lib/audit'

export default async function userRoutes(fastify: FastifyInstance) {

  // ─── User: submit deletion request ─────────────────────────────────────────
  fastify.post('/user/request-deletion', {
    preHandler: [authenticate],
  }, async (req, reply) => {
    const user = (req as any).user
    const { reason } = req.body as { reason?: string }

    // Check if user already has a pending request
    const existing = await prisma.deletionRequest.findFirst({
      where: { user_id: user.user_id, status: 'pending' },
    })
    if (existing) {
      return reply.code(409).send({ detail: 'You already have a pending deletion request.' })
    }

    const request = await prisma.deletionRequest.create({
      data: {
        user_id:    user.user_id,
        user_name:  user.name,
        user_email: user.email,
        reason:     reason?.trim() || null,
        status:     'pending',
      },
    })

    // Mark user as having requested deletion
    await prisma.user.update({
      where: { user_id: user.user_id },
      data: { delete_requested: true, delete_requested_at: new Date() },
    })

    return reply.code(201).send({
      message: 'Your account deletion request has been submitted. An administrator will review it shortly.',
      request_id: request.request_id,
    })
  })

  // ─── User: check own deletion request status ────────────────────────────────
  fastify.get('/user/deletion-request/status', {
    preHandler: [authenticate],
  }, async (req, reply) => {
    const user = (req as any).user

    const request = await prisma.deletionRequest.findFirst({
      where: { user_id: user.user_id },
      orderBy: { created_at: 'desc' },
    })

    if (!request) {
      return reply.send({ has_request: false })
    }

    return reply.send({
      has_request:   true,
      status:        request.status,
      reason:        request.reason,
      created_at:    request.created_at,
      reviewed_at:   request.reviewed_at,
      reviewer_name: request.reviewer_name,
    })
  })

  // ─── Admin: list deletion requests ─────────────────────────────────────────
  fastify.get('/admin/deletion-requests', {
    preHandler: [authenticate],
  }, async (req, reply) => {
    const user = (req as any).user
    if (!['admin', 'superuser'].includes(user.role)) {
      return reply.code(403).send({ detail: 'Forbidden' })
    }

    const { status = 'pending', page = '1', limit = '20' } = req.query as any
    const skip = (parseInt(page) - 1) * parseInt(limit)

    const where: any = {}
    if (status !== 'all') where.status = status

    const [requests, total] = await Promise.all([
      prisma.deletionRequest.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.deletionRequest.count({ where }),
    ])

    return reply.send({
      requests,
      total,
      page:       parseInt(page),
      total_pages: Math.ceil(total / parseInt(limit)),
    })
  })

  // ─── Admin: approve deletion request ───────────────────────────────────────
  fastify.put('/admin/deletion-requests/:request_id/approve', {
    preHandler: [authenticate],
  }, async (req, reply) => {
    const actor = (req as any).user
    if (!['admin', 'superuser'].includes(actor.role)) {
      return reply.code(403).send({ detail: 'Forbidden' })
    }

    const { request_id } = req.params as { request_id: string }

    const request = await prisma.deletionRequest.findUnique({ where: { request_id } })
    if (!request) return reply.code(404).send({ detail: 'Request not found' })
    if (request.status !== 'pending') {
      return reply.code(409).send({ detail: `Request is already ${request.status}` })
    }

    // Update request status
    await prisma.deletionRequest.update({
      where: { request_id },
      data: {
        status:        'approved',
        reviewed_by:   actor.user_id,
        reviewer_name: actor.name,
        reviewed_at:   new Date(),
      },
    })

    // Soft-delete: deactivate the user account (keep data for audit)
    // We mark the user as deleted by setting a special role or flag.
    // Hard delete cascades attendance — use soft delete approach.
    await prisma.user.update({
      where: { user_id: request.user_id },
      data: {
        role:               'deleted',
        delete_requested:   false,
        email:              `deleted_${Date.now()}_${request.user_email}`,
      },
    })

    // Audit log
    await auditLog({
      actor_id:    actor.user_id,
      actor_name:  actor.name,
      actor_role:  actor.role,
      action:      'APPROVE_DELETION',
      target_type: 'User',
      target_id:   request.user_id,
      metadata: {
        user_name:  request.user_name,
        user_email: request.user_email,
        reason:     request.reason,
      },
    })

    return reply.send({ message: `Account for ${request.user_name} has been deleted.` })
  })

  // ─── Admin: reject deletion request ────────────────────────────────────────
  fastify.put('/admin/deletion-requests/:request_id/reject', {
    preHandler: [authenticate],
  }, async (req, reply) => {
    const actor = (req as any).user
    if (!['admin', 'superuser'].includes(actor.role)) {
      return reply.code(403).send({ detail: 'Forbidden' })
    }

    const { request_id } = req.params as { request_id: string }
    const { rejection_reason } = req.body as { rejection_reason?: string }

    const request = await prisma.deletionRequest.findUnique({ where: { request_id } })
    if (!request) return reply.code(404).send({ detail: 'Request not found' })
    if (request.status !== 'pending') {
      return reply.code(409).send({ detail: `Request is already ${request.status}` })
    }

    await prisma.deletionRequest.update({
      where: { request_id },
      data: {
        status:        'rejected',
        reviewed_by:   actor.user_id,
        reviewer_name: actor.name,
        reviewed_at:   new Date(),
        reason:        rejection_reason
          ? `[Rejected: ${rejection_reason}] Original: ${request.reason || 'N/A'}`
          : request.reason,
      },
    })

    // Unmark the user's delete_requested flag
    await prisma.user.update({
      where: { user_id: request.user_id },
      data: { delete_requested: false, delete_requested_at: null },
    })

    // Audit log
    await auditLog({
      actor_id:    actor.user_id,
      actor_name:  actor.name,
      actor_role:  actor.role,
      action:      'REJECT_DELETION',
      target_type: 'User',
      target_id:   request.user_id,
      metadata: {
        user_name:        request.user_name,
        rejection_reason: rejection_reason || null,
      },
    })

    return reply.send({ message: `Deletion request for ${request.user_name} has been rejected.` })
  })
}
