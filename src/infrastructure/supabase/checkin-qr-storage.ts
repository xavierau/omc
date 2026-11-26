/**
 * BOOK-013 (threat R10, R16): the booking check-in QR in the public
 * `booking-checkin-qr` bucket (migration 095). The image holds only
 * `BK:<code>`; its object name is 192 random bits (never the code), so a link
 * cannot be guessed, and the bucket has no list policy. The name is stored on
 * the booking (`checkin_qr_path`) so the file can be deleted on cancel and by
 * the retention purge. Every read and write is scoped by restaurant.
 */
import { randomBytes } from 'crypto'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { generateQrBuffer } from '@/infrastructure/supabase/storage'
import { checkinQrPayload } from '@/domain/services/booking-checkin'
import type { CheckinQrStore } from '@/domain/ports/staff-booking'
import type { QrFileJanitor } from '@/application/booking/purge-booking-pii'

export const CHECKIN_QR_BUCKET = 'booking-checkin-qr'
/** The sample image the `confirmed` template's IMAGE header is submitted with. */
const EXAMPLE_PATH = 'examples/checkin-qr-example.png'
const EXAMPLE_CODE = 'K7Q2MX'

/** R10: 24 random bytes, base64url (32 chars) — the CHECK on checkin_qr_path wants 22–64. */
export const newQrObjectName = (): string => `${randomBytes(24).toString('base64url')}.png`

const bucket = () => createServerSupabaseClient().storage.from(CHECKIN_QR_BUCKET)
const publicUrl = (path: string) => bucket().getPublicUrl(path).data.publicUrl

async function storedPath(id: string, restaurantId: string): Promise<string | null> {
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .select('checkin_qr_path')
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .maybeSingle()
  if (error) throw new Error(`checkinQr path: ${error.message}`)
  return (data as { checkin_qr_path: string | null } | null)?.checkin_qr_path ?? null
}

async function upload(path: string, payload: string, upsert = false): Promise<void> {
  const png = await generateQrBuffer(payload)
  const { error } = await bucket().upload(path, png, { contentType: 'image/png', upsert })
  if (error) throw new Error(`checkinQr upload: ${error.message}`)
}

/** Records the new name only while none is stored (two senders at once keep one file). */
async function claimPath(booking: { id: string; restaurantId: string; checkinCode: string }, path: string): Promise<boolean> {
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .update({ checkin_qr_path: path })
    .eq('id', booking.id)
    .eq('restaurant_id', booking.restaurantId)
    .eq('checkin_code', booking.checkinCode)
    .is('checkin_qr_path', null)
    .select('id')
  if (error) throw new Error(`checkinQr claim: ${error.message}`)
  return (data ?? []).length === 1
}

async function removeFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const { error } = await bucket().remove(paths)
  if (error) throw new Error(`checkinQr remove: ${error.message}`)
}

async function ensure(booking: { id: string; restaurantId: string; checkinCode: string }): Promise<string | null> {
  try {
    const existing = await storedPath(booking.id, booking.restaurantId)
    if (existing) return publicUrl(existing)
    const path = newQrObjectName()
    await upload(path, checkinQrPayload(booking.checkinCode))
    if (await claimPath(booking, path)) return publicUrl(path)
    await removeFiles([path]).catch(() => undefined)
    const winner = await storedPath(booking.id, booking.restaurantId)
    return winner ? publicUrl(winner) : null
  } catch (err) {
    console.warn('[CheckinQr] not available:', { bookingId: booking.id, error: (err as Error).name })
    return null
  }
}

async function remove(booking: { id: string; restaurantId: string }): Promise<void> {
  try {
    const path = await storedPath(booking.id, booking.restaurantId)
    if (!path) return
    await removeFiles([path])
    await createServerSupabaseClient()
      .from('booking_requests')
      .update({ checkin_qr_path: null })
      .eq('id', booking.id)
      .eq('restaurant_id', booking.restaurantId)
      .eq('checkin_qr_path', path)
  } catch (err) {
    console.warn('[CheckinQr] delete failed:', { bookingId: booking.id, error: (err as Error).name })
  }
}

export const checkinQrStore: CheckinQrStore = { ensure, remove }

/** BOOK-013: the public sample QR for the template submission (fixed name, re-uploaded each time). */
export async function checkinQrExampleUrl(): Promise<string | null> {
  try {
    await upload(EXAMPLE_PATH, checkinQrPayload(EXAMPLE_CODE), true)
    return publicUrl(EXAMPLE_PATH)
  } catch (err) {
    console.warn('[CheckinQr] example image not available:', (err as Error).name)
    return null
  }
}

/** R16: QR files still stored on cancelled or declined bookings, deleted and forgotten. */
async function sweepClosed(limit: number): Promise<number> {
  const { data, error } = await createServerSupabaseClient()
    .from('booking_requests')
    .select('id, restaurant_id, checkin_qr_path')
    .in('status', ['cancelled', 'declined'])
    .not('checkin_qr_path', 'is', null)
    .limit(limit)
  if (error) throw new Error(`checkinQr sweep: ${error.message}`)
  const rows = (data ?? []) as Array<{ id: string; restaurant_id: string; checkin_qr_path: string }>
  for (const row of rows) await remove({ id: row.id, restaurantId: row.restaurant_id })
  return rows.length
}

export const checkinQrJanitor: QrFileJanitor = { removePaths: removeFiles, sweepClosed }
