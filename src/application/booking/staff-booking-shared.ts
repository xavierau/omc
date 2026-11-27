/**
 * BOOK-013: what staff create / edit / cancel share: their dependencies, the
 * Hong Kong clock, the rule check (owner decision 3: warn, staff may book
 * anyway) and the diner message (owner decision 2: only with Notify on; R11:
 * at most one staff-triggered message per booking per 5 minutes).
 */
import { hasPhone, type BookingRequest, type DecisionMessageStatus } from '@/domain/entities/booking-request'
import type { BookingMemberLookup, BookingMessageSender, BookingRoomReader, BookingSettingsReader } from '@/domain/ports/booking'
import type { StaffBookingStore } from '@/domain/ports/staff-booking'
import type { BookingMessageKind } from '@/domain/services/booking-message'
import type { BookingClock } from '@/domain/services/booking-hours'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import { activeSchedule } from '@/domain/value-objects/booking-hours'
import { brokenRules, type BrokenRule, type OwnSlot } from '@/domain/services/staff-booking-rules'
import type { StaffBookingInput } from '@/domain/services/staff-booking-input'
import { hongKongTime, hongKongToday } from '@/domain/services/booking-submission'
import { bookingMessageFor } from './booking-message-for'

/** R11: one staff-triggered diner message per booking in this window. */
export const STAFF_MESSAGE_GAP_MS = 5 * 60_000

export interface StaffBookingDeps {
  store: StaffBookingStore
  settings: BookingSettingsReader
  room: BookingRoomReader
  members: BookingMemberLookup
  sender: BookingMessageSender
  /** E.164, or null when not a phone number (the repo's one normaliser). */
  normalizePhone(raw: string): string | null
  /** Stores whether the confirmation reached the diner (the row's BOOK-001 "not delivered" badge). */
  recordMessage(id: string, restaurantId: string, status: DecisionMessageStatus): Promise<void>
  now(): Date
}

/**
 * What happened to the diner message: sent; not delivered (BOOK-001 warning);
 * skipped by R11 (another staff message went out in the last 5 minutes);
 * none (Notify off, or nothing the diner needs to know).
 */
export type StaffMessageOutcome = 'delivered' | 'not_delivered' | 'throttled' | 'none'

export type StaffRefusal =
  | { ok: false; reason: 'booking_off' }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid'; errors: Record<string, string> }
  | { ok: false; reason: 'rules'; rules: BrokenRule[] }
  | { ok: false; reason: 'open_change' }
  | { ok: false; reason: 'changed'; status: BookingRequest['status'] | null }
  /** R20: only a source 'staff' booking may have its phone cleared. */
  | { ok: false; reason: 'phone_required' }

export type StaffBookingResult = { ok: true; booking: BookingRequest; message: StaffMessageOutcome } | StaffRefusal

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function clockAt(now: Date): BookingClock {
  return { today: hongKongToday(now), nowTime: hongKongTime(now) }
}

/** R6 (spec AC-16): mode off refuses every staff write; simple and external allow it. */
export const bookingIsOff = (config: BookingConfig): boolean => config.mode === 'off'

/** Spec AC-3/AC-8: every rule the slot breaks (none without an active schedule; no room read then). */
export async function rulesFor(deps: StaffBookingDeps, restaurantId: string, config: BookingConfig, input: StaffBookingInput, own?: OwnSlot) {
  const clock = clockAt(deps.now())
  if (!activeSchedule(config.bookingHours)) return []
  const room = await deps.room.readRoom(restaurantId, input.date, input.date)
  return brokenRules(config.bookingHours, { date: input.date, time: input.time, partySize: input.partySize }, room, clock, own)
}

async function record(deps: StaffBookingDeps, booking: BookingRequest, delivered: boolean): Promise<void> {
  try {
    await deps.recordMessage(booking.id, booking.restaurantId, delivered ? 'delivered' : 'not_delivered')
  } catch (err) {
    // R13: the booking id and the error kind only, never the diner's details.
    console.error('[StaffBooking] message status not stored:', { bookingId: booking.id, error: (err as Error).name })
  }
}

/**
 * Owner decision 2 + R11: send `kind` to the diner when Notify is on and no
 * staff message went out in the last 5 minutes. Review R8: only a
 * confirmation's outcome is stored (decision_message_status is the BOOK-001
 * confirm/decline badge); a changed/cancelled outcome is only answered, so a
 * failed later message never marks a delivered confirmation "not delivered".
 * Decision 9 (R19): a booking without a phone is never messaged and records
 * no outcome, before the throttle claim and the sender.
 */
export async function messageDiner(deps: StaffBookingDeps, booking: BookingRequest, kind: BookingMessageKind, notify: boolean): Promise<StaffMessageOutcome> {
  if (!notify || !hasPhone(booking)) return 'none'
  if (!(await deps.store.claimStaffMessage(booking.id, booking.restaurantId, deps.now(), STAFF_MESSAGE_GAP_MS))) return 'throttled'
  const result = await deps.sender.send(await bookingMessageFor(deps, booking, kind))
  if (kind === 'confirmed') await record(deps, booking, result.delivered)
  return result.delivered ? 'delivered' : 'not_delivered'
}

/** A confirmation's outcome as the row's stored status, so the list shows it without a reload (staff create only). */
export function withOutcome(booking: BookingRequest, message: StaffMessageOutcome): BookingRequest {
  if (message === 'delivered' || message === 'not_delivered') return { ...booking, decisionMessageStatus: message }
  return booking
}
