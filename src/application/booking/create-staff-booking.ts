/**
 * BOOK-013 S1: staff add a booking (a phone or walk-up diner).
 *
 * The booking starts confirmed, source 'staff', created by the user, with its
 * check-in code (R8) and an events row (R9) in one transaction. Fields are
 * validated first and never overridable (R7); then the booking rules: broken
 * ones answer `rules` until staff book anyway (owner decision 3, AC-3). The
 * member link is an EXISTING member of this restaurant by phone, never a new
 * one (R17, BOOK-008). With Notify on, the diner gets the confirmation with
 * the QR (AC-1, AC-17); off, no message and no reminder (AC-2, AC-19).
 */
import { parseStaffBookingInput } from '@/domain/services/staff-booking-input'
import { brokenRuleCodes } from '@/domain/services/staff-booking-rules'
import {
  bookingIsOff,
  clockAt,
  messageDiner,
  rulesFor,
  withOutcome,
  type StaffBookingDeps,
  type StaffBookingResult,
} from './staff-booking-shared'

export interface CreateStaffBookingInput {
  restaurantId: string
  userId: string
  body: unknown
}

export async function createStaffBooking(deps: StaffBookingDeps, input: CreateStaffBookingInput): Promise<StaffBookingResult> {
  const config = await deps.settings.getConfig(input.restaurantId)
  if (bookingIsOff(config)) return { ok: false, reason: 'booking_off' }
  const parsed = parseStaffBookingInput(input.body, {
    maxPartySize: config.maxPartySize,
    clock: clockAt(deps.now()),
    normalizePhone: deps.normalizePhone,
  })
  if (!parsed.ok) return { ok: false, reason: 'invalid', errors: parsed.errors }
  const form = parsed.input
  const rules = await rulesFor(deps, input.restaurantId, config, form)
  if (rules.length > 0 && !form.override) return { ok: false, reason: 'rules', rules }

  const booking = await deps.store.create({
    restaurantId: input.restaurantId,
    memberId: await deps.members.findMemberId(input.restaurantId, form.phone),
    input: form,
    actorUserId: input.userId,
    at: deps.now(),
    codes: deps.newCodes(),
    brokenRules: brokenRuleCodes(rules),
  })
  const message = await messageDiner(deps, booking, 'confirmed', form.notify)
  return { ok: true, booking: withOutcome(booking, message), message }
}
