import prisma from './prisma'

/**
 * Build a Prisma `where` clause that scopes attendance/notification queries
 * to the admin's assigned jurisdiction.
 *
 * Jurisdiction types:
 *  - national  → no filter (see all)
 *  - province  → filter by facility names in that province (via OrgUnit)
 *  - district  → filter by facility names in that district (via OrgUnit)
 *  - facility  → exact facility name match
 *
 * Falls back to no filter if jurisdiction is not set.
 * Uses OrgUnit (not the empty legacy Facility table) for facility resolution.
 */
export async function getAdminScopeWhere(user: any): Promise<Record<string, any>> {
  // Superusers always see everything
  if (user.role === 'superuser') return {}

  const jurisdiction = user.assigned_jurisdiction as { type: string; value: string } | null

  // No jurisdiction assigned → no filter (see all records)
  if (!jurisdiction || jurisdiction.type === 'national') return {}

  const { type, value } = jurisdiction

  if (type === 'facility') {
    // Exact facility name match on Attendance.facility
    return { facility: value }
  }

  if (type === 'district') {
    // Resolve all OrgUnit names in this district
    const units = await prisma.orgUnit.findMany({
      where: { district: { name: { contains: value, mode: 'insensitive' } } },
      select: { name: true },
    })
    const names = units.map((u: { name: string }) => u.name)
    if (names.length === 0) {
      // Fallback: partial match on facility string
      return { facility: { contains: value, mode: 'insensitive' } }
    }
    return { facility: { in: names } }
  }

  if (type === 'province') {
    // Resolve all OrgUnit names in all districts of this province
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
