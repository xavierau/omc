/**
 * BOOK-013 S2: staff edit a pending or confirmed booking of any source.
 *
 * Status and source never change (owner decision 5). The write
 * is conditional on the status and `edit_version` the form loaded and on no
 * open change request (R3, R5): a stale form answers `changed`, an open change
 * `open_change`, and nothing is written or sent. Background writes (reminder,
 * message status, check-in) never make a form stale (review R1).
 * The `changed` message outcome is answered, never stored on the row: the
 * row's badge is the confirmation's (review R8). A moved slot re-checks the
 * rules without counting the booking against itself (AC-8) and makes the
 * reminder due again (AC-7); a new phone re-resolves the member (AC-9, R17).
 * The diner hears `changed` only when date, time or party size changed and
 * Notify is on (R11, AC-6).
 * Decision 9 (AC-28, R20): only a source 'staff' booking may lose its phone
 * (any other answers `phone_required`, nothing written); clearing it drops
 * the member link and Notify; adding one resolves the member as above.
 */
import type { BookingRequest } from '@/domain/entities/booking-request'
import { parseStaffBookingInput, type StaffBookingInput } from '@/domain/services/staff-booking-input'
import { brokenRuleCodes } from '@/domain/services/staff-booking-rules'
import {
  bookingIsOff,
  clockAt,
  messageDiner,
  rulesFor,
  UUID,
  type StaffBookingDeps,
  type StaffBookingResult,
} from './staff-booking-shared'

export interface EditStaffBookingInput {
  restaurantId: string
  userId: string
  bookingId: string
  body: unknown
}

const FIELDS = [
  ['phone', (b: BookingRequest) => b.phone],
  ['name', (b: BookingRequest) => b.name],
  ['partySize', (b: BookingRequest) => b.partySize],
  ['date', (b: BookingRequest) => b.bookingDate],
  ['time', (b: BookingRequest) => b.bookingTime],
  ['notes', (b: BookingRequest) => b.notes],
  ['notify', (b: BookingRequest) => b.notifyDiner ?? true],
] as const

/** R9: the names of the fields this edit changes (values never go into the events row). */
export function changedFields(current: BookingRequest, form: StaffBookingInput): string[] {
  return FIELDS.filter(([field, read]) => read(current) !== form[field]).map(([field]) => field)
}

const slotMoved = (changed: string[]) => changed.includes('date') || changed.includes('time')
/** R11 / AC-6: only these changes are news to the diner. */
const dinerNews = (changed: string[]) => slotMoved(changed) || changed.includes('partySize')

async function refusalAfterMiss(deps: StaffBookingDeps, input: EditStaffBookingInput): Promise<StaffBookingResult> {
  const now = await deps.store.find(input.bookingId, input.restaurantId)
  if (!now) return { ok: false, reason: 'not_found' }
  if (now.openChange) return { ok: false, reason: 'open_change' }
  return { ok: false, reason: 'changed', status: now.status }
}

async function memberFor(deps: StaffBookingDeps, restaurantId: string, current: BookingRequest, form: StaffBookingInput) {
  if (form.phone === null) return null
  return form.phone === current.phone ? current.memberId : deps.members.findMemberId(restaurantId, form.phone)
}

export async function editStaffBooking(deps: StaffBookingDeps, input: EditStaffBookingInput): Promise<StaffBookingResult> {
  const config = await deps.settings.getConfig(input.restaurantId)
  if (bookingIsOff(config)) return { ok: false, reason: 'booking_off' }
  if (!UUID.test(input.bookingId)) return { ok: false, reason: 'not_found' }
  const current = await deps.store.find(input.bookingId, input.restaurantId)
  if (!current) return { ok: false, reason: 'not_found' }
  if (current.status !== 'pending' && current.status !== 'confirmed') return { ok: false, reason: 'changed', status: current.status }
  if (current.openChange) return { ok: false, reason: 'open_change' }

  const parsed = parseStaffBookingInput(input.body, {
    maxPartySize: config.maxPartySize,
    clock: clockAt(deps.now()),
    normalizePhone: deps.normalizePhone,
    currentSlot: { date: current.bookingDate, time: current.bookingTime },
    requireExpectedVersion: true,
  })
  if (!parsed.ok) return { ok: false, reason: 'invalid', errors: parsed.errors }
  const form = parsed.input
  if (form.phone === null && current.source !== 'staff') return { ok: false, reason: 'phone_required' }
  const changed = changedFields(current, form)
  const own = { date: current.bookingDate, time: current.bookingTime, partySize: current.partySize, counted: true }
  const rules = dinerNews(changed) ? await rulesFor(deps, input.restaurantId, config, form, own) : []
  if (rules.length > 0 && !form.override) return { ok: false, reason: 'rules', rules }

  const updated = await deps.store.update({
    id: current.id,
    restaurantId: input.restaurantId,
    expectedStatus: current.status,
    expectedVersion: parsed.expectedVersion as number,
    memberId: await memberFor(deps, input.restaurantId, current, form),
    input: form,
    clearReminder: slotMoved(changed),
    actorUserId: input.userId,
    changed,
    brokenRules: brokenRuleCodes(rules),
  })
  if (!updated) return refusalAfterMiss(deps, input)
  const message = await messageDiner(deps, updated, 'changed', form.notify && dinerNews(changed))
  return { ok: true, booking: updated, message }
}
