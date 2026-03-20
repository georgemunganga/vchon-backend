import { v4 as uuidv4 } from 'uuid'
import prisma from './prisma'
import { haversineDistance } from './auth'

export async function checkAttendanceNotifications(
  user: any,
  record: any,
  area: string | null
) {
  try {
    const facilityName = user.facility
    const facilityDoc = await prisma.facility.findFirst({ where: { name: facilityName } })

    // Check 1: No GPS
    if (!record.latitude || !record.longitude) {
      if (area !== 'Outreach') {
        await prisma.notification.create({
          data: {
            notification_id: `notif_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
            type: 'no_gps',
            user_id: user.user_id,
            user_name: user.name,
            facility: facilityName,
            message: `${user.name} reported for duty without GPS coordinates`,
            timestamp: new Date(record.timestamp),
            read: false,
            attendance_id: record.attendance_id,
          },
        })
      }
      return
    }

    // Check 2: Distance from facility
    if (
      area !== 'Outreach' &&
      facilityDoc?.latitude &&
      facilityDoc?.longitude
    ) {
      const distance = haversineDistance(
        record.latitude, record.longitude,
        facilityDoc.latitude, facilityDoc.longitude
      )
      if (distance > 100) {
        await prisma.notification.create({
          data: {
            notification_id: `notif_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
            type: 'outside_radius',
            user_id: user.user_id,
            user_name: user.name,
            facility: facilityName,
            message: `${user.name} reported ${Math.round(distance)}m away from ${facilityName}`,
            distance_meters: Math.round(distance),
            latitude: record.latitude,
            longitude: record.longitude,
            timestamp: new Date(record.timestamp),
            read: false,
            attendance_id: record.attendance_id,
          },
        })
      }
    }
  } catch (err) {
    console.error('Notification check error:', err)
  }
}
