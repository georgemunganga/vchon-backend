import prisma from './prisma'
import { FACILITIES_BY_DISTRICT, DISTRICTS } from './constants'

export async function getAdminScopeWhere(user: any): Promise<Record<string, any>> {
  if (user.role === 'superuser') return {}

  const jurisdiction = user.assigned_jurisdiction as { type: string; value: string } | null
  if (!jurisdiction) {
    // Fallback: scope to user's own district
    const district = user.district
    if (!district) return {}
    const hardcoded = FACILITIES_BY_DISTRICT[district] || []
    const dbFacs = await prisma.facility.findMany({ where: { district }, select: { name: true } })
    const all = Array.from(new Set([...hardcoded, ...dbFacs.map((f) => f.name)]))
    return all.length ? { facility: { in: all } } : {}
  }

  const { type, value } = jurisdiction

  if (type === 'facility') {
    return { facility: value }
  }

  if (type === 'district') {
    const hardcoded = FACILITIES_BY_DISTRICT[value] || []
    const dbFacs = await prisma.facility.findMany({ where: { district: value }, select: { name: true } })
    const all = Array.from(new Set([...hardcoded, ...dbFacs.map((f) => f.name)]))
    return all.length ? { facility: { in: all } } : {}
  }

  if (type === 'province') {
    const provinceDists = DISTRICTS[value] || []
    let allFacs: string[] = []
    for (const d of provinceDists) {
      allFacs = allFacs.concat(FACILITIES_BY_DISTRICT[d] || [])
    }
    const dbFacs = await prisma.facility.findMany({ where: { province: value }, select: { name: true } })
    allFacs = Array.from(new Set([...allFacs, ...dbFacs.map((f) => f.name)]))
    return allFacs.length ? { facility: { in: allFacs } } : {}
  }

  return {}
}
