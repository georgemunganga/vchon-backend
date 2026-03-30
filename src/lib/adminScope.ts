import prisma from './prisma'

/**
 * Build a Prisma `where` clause that scopes attendance/notification queries
 * to the admin's assigned jurisdiction.
 *
 * Handles two jurisdiction shapes stored in the DB:
 *
 * NEW canonical shape (set via /superuser/users/:id/jurisdiction):
 *   { type: 'province' | 'district' | 'facility' | 'national', value: string }
 *
 * OLD shape (set by the seed / legacy admin panel):
 *   { province: string, districts: string[], facility: string | null }
 *
 * Superusers always see everything (no filter).
 * Falls back to no filter if jurisdiction is not set or unrecognised.
 * Uses OrgUnit (not the empty legacy Facility table) for facility resolution.
 */
export async function getAdminScopeWhere(user: any): Promise<Record<string, any>> {
  // Superusers always see everything
  if (user.role === 'superuser') return {}

  const jurisdiction = user.assigned_jurisdiction as any | null

  // No jurisdiction assigned → no filter (see all records)
  if (!jurisdiction) return {}

  // ── Normalise jurisdiction shape ──────────────────────────────────────────
  // Detect which shape we have and normalise to { type, value }
  let type: string
  let value: string

  if (jurisdiction.type) {
    // New canonical shape: { type, value }
    type = jurisdiction.type
    value = jurisdiction.value || ''
  } else if (jurisdiction.facility) {
    // Old shape with explicit facility name
    type = 'facility'
    value = jurisdiction.facility
  } else if (jurisdiction.districts && Array.isArray(jurisdiction.districts) && jurisdiction.districts.length > 0) {
    // Old shape: list of districts — resolve all OrgUnit names across every listed district
    const names: string[] = []
    for (const distName of jurisdiction.districts as string[]) {
      const units = await prisma.orgUnit.findMany({
        where: { district: { name: { contains: distName, mode: 'insensitive' } } },
        select: { name: true },
      })
      names.push(...units.map((u: { name: string }) => u.name))
    }
    const unique = [...new Set(names)]
    if (unique.length === 0) {
      // Fallback: partial match on each district name directly on Attendance.facility
      return { facility: { in: jurisdiction.districts } }
    }
    return { facility: { in: unique } }
  } else if (jurisdiction.province) {
    // Old shape: province only
    type = 'province'
    value = jurisdiction.province
  } else {
    // Unrecognised shape — no filter
    return {}
  }

  // ── Apply canonical type/value filter ────────────────────────────────────
  if (type === 'national') return {}

  if (type === 'facility') {
    return { facility: value }
  }

  if (type === 'district') {
    const units = await prisma.orgUnit.findMany({
      where: { district: { name: { contains: value, mode: 'insensitive' } } },
      select: { name: true },
    })
    const names = units.map((u: { name: string }) => u.name)
    if (names.length === 0) return { facility: { contains: value, mode: 'insensitive' } }
    return { facility: { in: names } }
  }

  if (type === 'province') {
    const units = await prisma.orgUnit.findMany({
      where: { district: { province: { name: { contains: value, mode: 'insensitive' } } } },
      select: { name: true },
    })
    const names = units.map((u: { name: string }) => u.name)
    if (names.length === 0) return {}
    return { facility: { in: names } }
  }

  return {}
}
