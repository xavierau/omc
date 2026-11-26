/**
 * BOOK-013 S3: staff cancel a confirmed booking of any source (a soft cancel:
 * status cancelled, cancelled_by 'staff', the user and time stored; owner
 * decision 4). A pending one is declined instead. The write is conditional on
 * the `edit_version` the dialog loaded and on no open change request (R3, R5,
 * AC-13; review R1); a refused cancel changes and sends nothing. The QR file is
 * deleted (R16); with Notify on the diner gets `cancelled` (AC-12), whose
 * outcome is answered but never stored on the row (review R8).
 */
import { isEditVersion } from '@/domain/services/staff-booking-input'
import {
  bookingIsOff,
  messageDiner,
  UUID,
  type StaffBookingDeps,
  type StaffBookingResult,
} from './staff-booking-shared'

export interface CancelStaffBookingInput {
  restaurantId: string
  userId: string
  bookingId: string
  body: unknown
}

interface CancelBody {
  expectedVersion: number
  notify: boolean
}

/** R4: only these two keys are read. */
function parseCancelBody(raw: unknown): CancelBody | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const b = raw as Record<string, unknown>
  if (!isEditVersion(b.expectedVersion)) return null
  if (b.notify !== undefined && typeof b.notify !== 'boolean') return null
  return { expectedVersion: b.expectedVersion, notify: b.notify !== false }
}

export async function cancelStaffBooking(deps: StaffBookingDeps, input: CancelStaffBookingInput): Promise<StaffBookingResult> {
  if (bookingIsOff(await deps.settings.getConfig(input.restaurantId))) return { ok: false, reason: 'booking_off' }
  if (!UUID.test(input.bookingId)) return { ok: false, reason: 'not_found' }
  const body = parseCancelBody(input.body)
  if (!body) return { ok: false, reason: 'invalid', errors: { expectedVersion: 'required' } }
  const current = await deps.store.find(input.bookingId, input.restaurantId)
  if (!current) return { ok: false, reason: 'not_found' }
  if (current.status !== 'confirmed') return { ok: false, reason: 'changed', status: current.status }
  if (current.openChange) return { ok: false, reason: 'open_change' }

  const cancelled = await deps.store.cancel({
    id: current.id,
    restaurantId: input.restaurantId,
    expectedVersion: body.expectedVersion,
    actorUserId: input.userId,
    at: deps.now(),
  })
  if (!cancelled) {
    const now = await deps.store.find(input.bookingId, input.restaurantId)
    if (now?.openChange) return { ok: false, reason: 'open_change' }
    return now ? { ok: false, reason: 'changed', status: now.status } : { ok: false, reason: 'not_found' }
  }
  await deps.qr.remove({ id: cancelled.id, restaurantId: cancelled.restaurantId })
  const message = await messageDiner(deps, cancelled, 'cancelled', body.notify)
  return { ok: true, booking: cancelled, message }
}
