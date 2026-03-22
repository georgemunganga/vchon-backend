/**
 * VChron Geography & Organisation Seeder
 *
 * Seeds:
 *  1. Ministries (Health, Education)
 *  2. Provinces (all 10 Zambian provinces)
 *  3. Districts (all districts per province)
 *  4. OrgUnits (facilities for Ministry of Health, placeholder schools for Education)
 *  5. Positions (per ministry)
 *
 * Run: pnpm seed:geo
 *
 * This seeder is idempotent — safe to run multiple times.
 */

import { PrismaClient } from '@prisma/client'
import * as dotenv from 'dotenv'

dotenv.config()

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
})

// ─── Source Data ─────────────────────────────────────────────────────────────

const PROVINCES_DATA = [
  'Central Province',
  'Copperbelt Province',
  'Eastern Province',
  'Luapula Province',
  'Lusaka Province',
  'Muchinga Province',
  'Northern Province',
  'North-Western Province',
  'Southern Province',
  'Western Province',
]

const DISTRICTS_DATA: Record<string, string[]> = {
  'Central Province': [
    'Chibombo', 'Chisamba', 'Chitambo', 'Kabwe', 'Kapiri Mposhi',
    'Luano', 'Mkushi', 'Mumbwa', 'Ngabwe', 'Serenje', 'Shibuyunji',
  ],
  'Copperbelt Province': [
    'Chililabombwe', 'Chingola', 'Kalulushi', 'Kitwe', 'Luanshya',
    'Lufwanyama', 'Masaiti', 'Mpongwe', 'Mufulira', 'Ndola',
  ],
  'Eastern Province': [
    'Chadiza', 'Chama', 'Chipata', 'Katete', 'Lundazi',
    'Mambwe', 'Nyimba', 'Petauke', 'Sinda', 'Vubwi',
  ],
  'Luapula Province': [
    'Chembe', 'Chiengi', 'Chipili', 'Kawambwa', 'Lunga',
    'Mansa', 'Milenge', 'Mwense', 'Nchelenge', 'Samfya',
  ],
  'Lusaka Province': [
    'Chilanga', 'Chongwe', 'Kafue', 'Luangwa', 'Lusaka',
    'Rufunsa', 'Shibuyunji',
  ],
  'Muchinga Province': [
    'Chinsali', 'Isoka', 'Kanchibiya', 'Lavushimanda', 'Mafinga',
    'Mpika', 'Mushindamo', 'Nakonde', 'Shiwang\'andu',
  ],
  'Northern Province': [
    'Chilubi', 'Kaputa', 'Kasama', 'Luwingu', 'Mbala',
    'Mporokoso', 'Mpulungu', 'Mungwi', 'Nsama',
  ],
  'North-Western Province': [
    'Chavuma', 'Ikelenge', 'Kabompo', 'Kasempa', 'Manyinga',
    'Mufumbwe', 'Mushindamo', 'Mwinilunga', 'Solwezi', 'Zambezi',
  ],
  'Southern Province': [
    'Chikankata', 'Chirundu', 'Choma', 'Gwembe', 'Itezhi-Tezhi',
    'Kalomo', 'Kazungula', 'Livingstone', 'Mazabuka', 'Monze',
    'Namwala', 'Pemba', 'Siavonga', 'Sinazongwe', 'Zimba',
  ],
  'Western Province': [
    'Kalabo', 'Kaoma', 'Limulunga', 'Lukulu', 'Mitete',
    'Mongu', 'Mulobezi', 'Mwandi', 'Nalolo', 'Nkeyema',
    'Senanga', 'Sesheke', 'Shangombo',
  ],
}

const HEALTH_FACILITIES_BY_DISTRICT: Record<string, string[]> = {
  Mkushi: [
    'Chalata Rural Health Centre', 'Changilo Health Post', 'Chibwemukunga Health Post',
    'Nambo Rural Health Post', 'Ntekete Health Post', 'Chibefwe Health Centre',
    'Milombwe Health Post', 'Tazara Health Post', 'Mulundu Health Post',
    'Chitina Health Post', 'Chikabile Health Post', 'Kabengeshi Rural Health Post',
    'Kakushi Health Post', 'Luanshimba Rural Health Centre (Mkushi)', 'Mboboli Rural Health Post',
    'Mulungwe Rural Health Centre', 'Matuku Health Post', 'Miloso Health Post',
    'Momboshi Health Post', 'Twatasha Health Post', 'Fibanga Health Post',
    'Munsakamba Health Post', 'Katuba Health Post', 'Nkulumashiba Rural Health Post',
    'Chisanga Rural Health Centre', 'Musofu Rural Health Centre', 'Upper Musofu Health Post',
    'Chengelo Clinic', 'Kasalamakanga Health Post', 'Nkolonga Farm Clinic',
    'Nkolonga Health Post', 'Chine Rural Health Post', 'Fiwila Rural Health Centre',
    'Kalubula Rural Health Post', 'Nyenje Health Post', 'Shaibila Health Post',
    'Kasokota Health Post', 'Mikunku Rural Health Centre', 'Nkumbi College Clinic',
    'Nkumbi Rural Health Centre', 'Lilanda Health Post', 'Malubila Health Post',
    'Mankanda Health Post', 'Milele Health Post', 'Nshinso Rural Health Centre',
    'Upper Lusemfwa Health Post', 'Mkushi District Hospital',
  ],
  Kabwe: [
    'Kabwe General Hospital', 'Kabwe Urban Clinic', 'Makululu Health Post',
    'Natuseko Clinic', 'Bwacha Clinic', 'Kasanda Rural Health Centre',
    'Lukanga Rural Health Centre', 'Ngungu Rural Health Centre',
  ],
  Serenje: [
    'Serenje District Hospital', 'Serenje Urban Clinic', 'Chibale Rural Health Centre',
    'Kanona Rural Health Centre', 'Mita Hills Rural Health Centre',
  ],
  Chibombo: [
    'Chibombo Rural Health Centre', 'Chisamba Rural Health Centre',
    'Keembe Rural Health Centre', 'Munyumbwe Rural Health Centre',
  ],
  Chisamba: [
    'Chisamba Rural Health Centre', 'Fringilla Clinic', 'Mpima Mental Hospital',
  ],
  'Kapiri Mposhi': [
    'Kapiri Mposhi District Hospital', 'Kapiri Mposhi Urban Clinic',
    'Lubewe Rural Health Centre', 'Mufulwe Rural Health Centre',
  ],
  Mumbwa: [
    'Mumbwa District Hospital', 'Mumbwa Urban Clinic', 'Nangoma Rural Health Centre',
    'Shimabala Rural Health Centre',
  ],
  Lusaka: [
    'University Teaching Hospital', 'Lusaka Trust Hospital', 'Chilenje Clinic',
    'Chipata Clinic', 'Chawama Clinic', 'Matero Clinic', 'Kanyama Clinic',
    'Chelstone Clinic', 'Kalingalinga Clinic', 'Kamwala Clinic',
    'Mtendere Clinic', 'Lilayi Clinic', 'Roma Clinic',
  ],
  Kitwe: [
    'Kitwe Teaching Hospital', 'Wusakile Mine Hospital', 'Nkana Mine Hospital',
    'Kitwe Central Clinic', 'Chamboli Clinic', 'Mindolo Clinic',
  ],
  Ndola: [
    'Ndola Teaching Hospital', 'Ndola Central Hospital', 'Arthur Davison Children\'s Hospital',
    'Kanini Clinic', 'Masala Clinic', 'Twapia Clinic',
  ],
  Chipata: [
    'Chipata General Hospital', 'Chipata Urban Clinic', 'Msekera Research Station Clinic',
    'Kapata Clinic', 'Chiparamba Clinic',
  ],
  Livingstone: [
    'Livingstone General Hospital', 'Livingstone Central Clinic',
    'Maramba Clinic', 'Dambwa Clinic', 'Libuyu Clinic',
  ],
  Choma: [
    'Choma General Hospital', 'Choma Urban Clinic', 'Mapanza Rural Health Centre',
    'Pemba Rural Health Centre',
  ],
  Kasama: [
    'Kasama General Hospital', 'Kasama Urban Clinic', 'Mungwi Rural Health Centre',
    'Luwingu Rural Health Centre',
  ],
  Mansa: [
    'Mansa General Hospital', 'Mansa Urban Clinic', 'Samfya Rural Health Centre',
  ],
  Solwezi: [
    'Solwezi General Hospital', 'Solwezi Urban Clinic', 'Mushindamo Rural Health Centre',
  ],
  Mongu: [
    'Lewanika General Hospital', 'Mongu Urban Clinic', 'Kaoma Rural Health Centre',
  ],
  Mpika: [
    'Mpika General Hospital', 'Mpika Urban Clinic', 'Kanchibiya Rural Health Centre',
  ],
}

const HEALTH_POSITIONS = [
  'Nurse', 'Registered Nurse', 'Clinical Officer', 'Environmental Health Technician',
  'Medical Doctor', 'Medical Officer', 'Pharmacist', 'Laboratory Technician',
  'Radiographer', 'Physiotherapist', 'Midwife', 'Community Health Worker',
  'Nurse Manager', 'Administrative Staff', 'Other',
]

const EDUCATION_POSITIONS = [
  'Teacher', 'Head Teacher', 'Deputy Head Teacher', 'School Counsellor',
  'Laboratory Technician', 'Administrative Staff', 'Librarian', 'Other',
]

// ─── Main Seeder ─────────────────────────────────────────────────────────────

async function main() {
  console.log('🌍  Starting VChron Geography Seeder...\n')

  // ─── 1. Ministries ────────────────────────────────────────────────────────
  const healthMinistry = await prisma.ministry.upsert({
    where: { name: 'Ministry of Health' },
    update: {},
    create: { name: 'Ministry of Health', unit_term: 'Facility' },
  })
  const educationMinistry = await prisma.ministry.upsert({
    where: { name: 'Ministry of Education' },
    update: {},
    create: { name: 'Ministry of Education', unit_term: 'School' },
  })
  console.log(`✅  Ministries seeded: Health (id:${healthMinistry.id}), Education (id:${educationMinistry.id})`)

  // ─── 2. Provinces ────────────────────────────────────────────────────────
  const provinceMap: Record<string, number> = {}
  for (const provinceName of PROVINCES_DATA) {
    const p = await prisma.province.upsert({
      where: { name: provinceName },
      update: {},
      create: { name: provinceName },
    })
    provinceMap[provinceName] = p.id
  }
  console.log(`✅  Provinces seeded: ${PROVINCES_DATA.length} provinces`)

  // ─── 3. Districts ────────────────────────────────────────────────────────
  const districtMap: Record<string, number> = {}
  let districtCount = 0
  for (const [provinceName, districts] of Object.entries(DISTRICTS_DATA)) {
    const provinceId = provinceMap[provinceName]
    if (!provinceId) continue
    for (const districtName of districts) {
      const d = await prisma.district.upsert({
        where: { name_province_id: { name: districtName, province_id: provinceId } },
        update: {},
        create: { name: districtName, province_id: provinceId },
      })
      districtMap[districtName] = d.id
      districtCount++
    }
  }
  console.log(`✅  Districts seeded: ${districtCount} districts`)

  // ─── 4. Health Facilities (OrgUnits) ─────────────────────────────────────
  let facilityCount = 0
  for (const [districtName, facilities] of Object.entries(HEALTH_FACILITIES_BY_DISTRICT)) {
    const districtId = districtMap[districtName]
    if (!districtId) {
      console.warn(`⚠️   District not found: ${districtName} — skipping its facilities`)
      continue
    }
    for (const facilityName of facilities) {
      await prisma.orgUnit.upsert({
        where: {
          name_district_id_ministry_id: {
            name: facilityName,
            district_id: districtId,
            ministry_id: healthMinistry.id,
          },
        },
        update: {},
        create: {
          name: facilityName,
          ministry_id: healthMinistry.id,
          district_id: districtId,
        },
      })
      facilityCount++
    }
  }
  console.log(`✅  Health Facilities (OrgUnits) seeded: ${facilityCount} facilities`)

  // ─── 5. Positions ────────────────────────────────────────────────────────
  let positionCount = 0
  for (const posName of HEALTH_POSITIONS) {
    await prisma.position.upsert({
      where: { name_ministry_id: { name: posName, ministry_id: healthMinistry.id } },
      update: {},
      create: { name: posName, ministry_id: healthMinistry.id },
    })
    positionCount++
  }
  for (const posName of EDUCATION_POSITIONS) {
    await prisma.position.upsert({
      where: { name_ministry_id: { name: posName, ministry_id: educationMinistry.id } },
      update: {},
      create: { name: posName, ministry_id: educationMinistry.id },
    })
    positionCount++
  }
  console.log(`✅  Positions seeded: ${positionCount} positions`)

  console.log('\n🎉  Geography seed complete!\n')
  console.log('Summary:')
  console.log(`  Ministries : 2`)
  console.log(`  Provinces  : ${PROVINCES_DATA.length}`)
  console.log(`  Districts  : ${districtCount}`)
  console.log(`  OrgUnits   : ${facilityCount}`)
  console.log(`  Positions  : ${positionCount}`)
}

main()
  .catch((e) => {
    console.error('❌  Geography seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
