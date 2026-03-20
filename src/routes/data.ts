import { FastifyInstance } from 'fastify'
import prisma from '../lib/prisma'
import { PROVINCES, DISTRICTS, FACILITIES_BY_DISTRICT, FACILITIES, POSITIONS, AREAS_OF_ALLOCATION } from '../lib/constants'

export default async function dataRoutes(fastify: FastifyInstance) {
  fastify.get('/facilities', async (_req, reply) => {
    return reply.send({ facilities: FACILITIES })
  })

  fastify.get('/positions', async (_req, reply) => {
    return reply.send({ positions: POSITIONS })
  })

  fastify.get('/areas', async (_req, reply) => {
    return reply.send({ areas: AREAS_OF_ALLOCATION })
  })

  fastify.get('/provinces', async (_req, reply) => {
    return reply.send({ provinces: PROVINCES })
  })

  fastify.get('/districts/:province', async (request, reply) => {
    const { province } = request.params as { province: string }
    const hardcoded = DISTRICTS[province] || []
    const dbFacs = await prisma.facility.findMany({ where: { province }, select: { district: true } })
    const dbDistricts = [...new Set(dbFacs.map((f) => f.district))]
    const merged = [...new Set([...hardcoded, ...dbDistricts])].sort()
    return reply.send({ province, districts: merged })
  })

  fastify.get('/facilities/:district', async (request, reply) => {
    const { district } = request.params as { district: string }
    const hardcoded = FACILITIES_BY_DISTRICT[district] || []
    const dbFacs = await prisma.facility.findMany({ where: { district }, select: { name: true } })
    const dbNames = dbFacs.map((f) => f.name)
    const merged = [...new Set([...hardcoded, ...dbNames])].sort()
    return reply.send({ district, facilities: merged })
  })
}
