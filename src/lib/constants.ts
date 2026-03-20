export const PROVINCES = [
  { id: 1, name: 'Central Province' },
  { id: 2, name: 'Copperbelt Province' },
  { id: 3, name: 'Eastern Province' },
  { id: 4, name: 'Luapula Province' },
  { id: 5, name: 'Lusaka Province' },
  { id: 6, name: 'Muchinga Province' },
  { id: 7, name: 'Northern Province' },
  { id: 8, name: 'North-Western Province' },
  { id: 9, name: 'Southern Province' },
  { id: 10, name: 'Western Province' },
]

export const DISTRICTS: Record<string, string[]> = {
  'Central Province': [
    'Chibombo', 'Chisamba', 'Chitambo', 'Kabwe', 'Kapiri Mposhi',
    'Luano', 'Mkushi', 'Mumbwa', 'Ngabwe', 'Serenje', 'Shibuyunji',
  ],
}

export const FACILITIES_BY_DISTRICT: Record<string, string[]> = {
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
}

export const FACILITIES = FACILITIES_BY_DISTRICT['Mkushi'] || []

export const POSITIONS = [
  'Nurse', 'Clinical Officer', 'Environmental Health Technician', 'Medical Doctor',
  'Pharmacist', 'Laboratory Technician', 'Radiographer', 'Physiotherapist',
  'Midwife', 'Community Health Worker', 'Administrative Staff', 'Other',
]

export const AREAS_OF_ALLOCATION = ['Facility', 'Outreach']

export const DEFAULT_SHIFTS = {
  morning:   { start: '06:00', end: '14:00' },
  afternoon: { start: '14:00', end: '22:00' },
  night:     { start: '22:00', end: '06:00' },
  four_off:  { start: '07:00', end: '19:00' },
  on_call:   { start: '00:00', end: '23:59' },
}
