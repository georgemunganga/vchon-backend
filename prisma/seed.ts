/**
 * VChron Database Seed Script
 * Creates demo accounts for all three user roles:
 *   - superuser  → full system access
 *   - admin      → jurisdiction-scoped access (province/district/facility)
 *   - user       → regular healthcare worker
 *
 * Run: pnpm seed
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import * as dotenv from 'dotenv'

dotenv.config()

// Use direct DB URL for seeding (not Accelerate) to avoid caching issues
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
})

function hash(password: string): string {
  return bcrypt.hashSync(password, 10)
}

async function main() {
  console.log('🌱  Starting VChron seed...\n')

  // ─── 1. Shift Config (default) ────────────────────────────────────────────
  await prisma.shiftConfig.upsert({
    where: { config_id: 'default' },
    update: {},
    create: {
      config_id: 'default',
      morning_start: '06:00',
      morning_end: '14:00',
      afternoon_start: '14:00',
      afternoon_end: '22:00',
      night_start: '22:00',
      night_end: '06:00',
      four_off_start: '07:00',
      four_off_end: '19:00',
      on_call_start: '00:00',
      on_call_end: '23:59',
      grace_period_minutes: 15,
    },
  })
  console.log('✅  ShiftConfig (default) upserted')

  // ─── 2. Super User ────────────────────────────────────────────────────────
  const superUser = await prisma.user.upsert({
    where: { email: 'superuser@vchron.demo' },
    update: { password: hash('SuperDemo@2026') },
    create: {
      user_id: uuidv4(),
      email: 'superuser@vchron.demo',
      password: hash('SuperDemo@2026'),
      name: 'Super Admin',
      phone_number: '+260971000001',
      position: 'System Administrator',
      province: 'Lusaka Province',
      district: 'Lusaka',
      facility: 'University Teaching Hospital',
      area_of_allocation: 'Administration',
      role: 'superuser',
      assigned_shift: 'morning',
    },
  })
  console.log(`✅  Superuser:  ${superUser.email}  (role: ${superUser.role})`)

  // ─── 3. Admin User ────────────────────────────────────────────────────────
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@vchron.demo' },
    update: { password: hash('AdminDemo@2026') },
    create: {
      user_id: uuidv4(),
      email: 'admin@vchron.demo',
      password: hash('AdminDemo@2026'),
      name: 'Province Admin',
      phone_number: '+260971000002',
      position: 'Nurse Manager',
      province: 'Central Province',
      district: 'Kabwe',
      facility: 'Kabwe General Hospital',
      area_of_allocation: 'Ward A',
      role: 'admin',
      assigned_shift: 'morning',
      // Scoped to Central Province → Kabwe district
      assigned_scope: {
        province: 'Central Province',
        district: 'Kabwe',
        facility: null,
      },
      assigned_jurisdiction: {
        province: 'Central Province',
        districts: ['Kabwe', 'Mkushi', 'Serenje'],
      },
    },
  })
  console.log(`✅  Admin:      ${adminUser.email}  (role: ${adminUser.role})`)

  // ─── 4. Regular Users (3 demo healthcare workers) ─────────────────────────
  const workers = [
    {
      email: 'nurse.demo@vchron.demo',
      password: 'NurseDemo@2026',
      name: 'Grace Mwansa',
      phone_number: '+260971000003',
      position: 'Registered Nurse',
      province: 'Central Province',
      district: 'Kabwe',
      facility: 'Kabwe General Hospital',
      area_of_allocation: 'Ward A',
      assigned_shift: 'morning',
    },
    {
      email: 'doctor.demo@vchron.demo',
      password: 'DoctorDemo@2026',
      name: 'Dr. James Phiri',
      phone_number: '+260971000004',
      position: 'Medical Officer',
      province: 'Central Province',
      district: 'Mkushi',
      facility: 'Mkushi District Hospital',
      area_of_allocation: 'Outpatient',
      assigned_shift: 'afternoon',
    },
    {
      email: 'chw.demo@vchron.demo',
      password: 'ChwDemo@2026',
      name: 'Mary Banda',
      phone_number: '+260971000005',
      position: 'Community Health Worker',
      province: 'Central Province',
      district: 'Serenje',
      facility: 'Serenje District Hospital',
      area_of_allocation: 'Community',
      assigned_shift: 'on_call',
    },
  ]

  for (const w of workers) {
    const u = await prisma.user.upsert({
      where: { email: w.email },
      update: { password: hash(w.password) },
      create: {
        user_id: uuidv4(),
        email: w.email,
        password: hash(w.password),
        name: w.name,
        phone_number: w.phone_number,
        position: w.position,
        province: w.province,
        district: w.district,
        facility: w.facility,
        area_of_allocation: w.area_of_allocation,
        role: 'user',
        assigned_shift: w.assigned_shift,
      },
    })
    console.log(`✅  Worker:     ${u.email}  (role: ${u.role})`)
  }

  console.log('\n🎉  Seed complete! Demo credentials:\n')
  console.log('┌─────────────────────────────────────────────────────────────────────┐')
  console.log('│  Role        │  Email                      │  Password              │')
  console.log('├─────────────────────────────────────────────────────────────────────┤')
  console.log('│  superuser   │  superuser@vchron.demo      │  SuperDemo@2026        │')
  console.log('│  admin       │  admin@vchron.demo          │  AdminDemo@2026        │')
  console.log('│  nurse       │  nurse.demo@vchron.demo     │  NurseDemo@2026        │')
  console.log('│  doctor      │  doctor.demo@vchron.demo    │  DoctorDemo@2026       │')
  console.log('│  chw         │  chw.demo@vchron.demo       │  ChwDemo@2026          │')
  console.log('└─────────────────────────────────────────────────────────────────────┘')
}

main()
  .catch((e) => {
    console.error('❌  Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
