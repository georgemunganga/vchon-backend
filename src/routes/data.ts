/**
 * VChron Data Routes
 *
 * Serves dynamic geographic and organisational hierarchy data from the database.
 * All endpoints are public (no auth required) to support the registration wizard.
 *
 * NEW endpoints:
 *   GET /api/data/ministries
 *   GET /api/data/provinces
 *   GET /api/data/districts?province_id=X
 *   GET /api/data/org-units?district_id=X&ministry_id=Y
 *   GET /api/data/positions?ministry_id=X
 *
 * Legacy endpoints (kept for backward compatibility):
 *   GET /api/data/facilities
 *   GET /api/data/facilities/:district
 *   GET /api/data/areas
 *   GET /api/data/districts/:province  (string-based, legacy)
 */

import { FastifyInstance } from 'fastify'
import prisma from '../lib/prisma'

export default async function dataRoutes(fastify: FastifyInstance) {

  // ─── NEW: Ministries (active only — filtered server-side) ────────────────────────────────────────
  fastify.get('/data/ministries', async (_req, reply) => {
    const ministries = await prisma.ministry.findMany({
      where: { is_active: true },   // only return ministries activated by Superuser
      orderBy: { name: 'asc' },
      select: { id: true, name: true, unit_term: true },
    })
    return reply.send({ ministries })
  })

  // ─── NEW: Provinces (from DB) ─────────────────────────────────────────────────
  fastify.get('/data/provinces', async (_req, reply) => {
    const provinces = await prisma.province.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })
    return reply.send({ provinces })
  })

  // ─── NEW: Districts by province_id ────────────────────────────────────────────
  fastify.get('/data/districts', async (request, reply) => {
    const { province_id } = request.query as { province_id?: string }
    if (!province_id) {
      return reply.code(400).send({ detail: 'province_id query param is required' })
    }
    const districts = await prisma.district.findMany({
      where: { province_id: parseInt(province_id) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, province_id: true },
    })
    return reply.send({ districts })
  })

  // ─── NEW: Org Units by district_id + ministry_id ──────────────────────────────
  fastify.get('/data/org-units', async (request, reply) => {
    const { district_id, ministry_id } = request.query as {
      district_id?: string
      ministry_id?: string
    }
    if (!district_id || !ministry_id) {
      return reply.code(400).send({ detail: 'district_id and ministry_id query params are required' })
    }
    const orgUnits = await prisma.orgUnit.findMany({
      where: {
        district_id: parseInt(district_id),
        ministry_id: parseInt(ministry_id),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        district_id: true,
        ministry_id: true,
        latitude: true,
        longitude: true,
      },
    })
    return reply.send({ org_units: orgUnits })
  })

  // ─── NEW: Positions (optionally filtered by ministry_id) ──────────────────────
  fastify.get('/data/positions', async (request, reply) => {
    const { ministry_id } = request.query as { ministry_id?: string }
    const where: any = ministry_id
      ? { OR: [{ ministry_id: parseInt(ministry_id) }, { ministry_id: null }] }
      : {}
    const positions = await prisma.position.findMany({
      where,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, ministry_id: true },
    })
    return reply.send({ positions })
  })

  // ─── LEGACY: /data/areas ──────────────────────────────────────────────────────
  fastify.get('/data/areas', async (_req, reply) => {
    return reply.send({ areas: ['Facility', 'Outreach'] })
  })

  // ─── LEGACY: /data/facilities (flat list from OrgUnits) ──────────────────────
  fastify.get('/data/facilities', async (_req, reply) => {
    const units = await prisma.orgUnit.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })
    return reply.send({ facilities: units.map((u) => u.name) })
  })

  // ─── LEGACY: /data/facilities/:district (string-based) ───────────────────────
  fastify.get('/data/facilities/:district', async (request, reply) => {
    const { district } = request.params as { district: string }
    const districtRecord = await prisma.district.findFirst({
      where: { name: district },
    })
    if (!districtRecord) {
      return reply.send({ district, facilities: [] })
    }
    const units = await prisma.orgUnit.findMany({
      where: { district_id: districtRecord.id },
      orderBy: { name: 'asc' },
      select: { name: true },
    })
    return reply.send({ district, facilities: units.map((u) => u.name) })
  })

  // ─── LEGACY: /data/districts/:province (string-based) ────────────────────────
  fastify.get('/data/districts/:province', async (request, reply) => {
    const { province } = request.params as { province: string }
    const provinceRecord = await prisma.province.findUnique({
      where: { name: province },
    })
    if (!provinceRecord) {
      return reply.send({ province, districts: [] })
    }
    const districts = await prisma.district.findMany({
      where: { province_id: provinceRecord.id },
      orderBy: { name: 'asc' },
      select: { name: true },
    })
    return reply.send({ province, districts: districts.map((d) => d.name) })
  })
}
