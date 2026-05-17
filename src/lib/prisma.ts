import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof makePrismaClient> | undefined
}

function makePrismaClient() {
  return new PrismaClient()
}

export const prisma = globalForPrisma.prisma ?? makePrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
