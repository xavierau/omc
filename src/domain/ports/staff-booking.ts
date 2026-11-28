/**
 * BOOK-013: ports for staff create / edit / cancel and check-in. Supabase
 * adapters live in `staff-booking-repository.ts` (RPCs from migration 095);
 * tests use in-memory fakes with the same conditions. Every call is scoped by
 * the session's restaurant inside the query (R2) and every write is one
 * conditional statement with its events row (R3, R9).
 */
import type { BookingRequest } from '@/domain/entities/booking-request'
import type { BookingDeposit, NewDepositHold } from '@/domain/entities/booking-deposit'
import type { StaffBookingInput } from '@/domain/services/staff-booking-input'
import type { Money } from '@/domain/value-objects/money'

export interface StaffCreateArgs {
  restaurantId: string
  memberId: string | null
  input: StaffBookingInput
  actorUserId: string
  at: Date
  brokenRules: string[]
  /**
   * BOOK-014 W4 (spec AC-11, R60): staff turned off a deposit the rule asked
   * for; the 'waived' deposit event (this amount, this user) is written with
   * the booking, in one transaction (migration 097).
   */
  waivedDeposit?: Money
}

export interface StaffUpdateArgs {
  id: string
  restaurantId: string
  expectedStatus: 'pending' | 'confirmed'
  /** The edit_version the form loaded (review R1: background writes never move it). */
  expectedVersion: number
  memberId: string | null
  input: StaffBookingInput
  clearReminder: boolean
  actorUserId: string
  changed: string[]
  brokenRules: string[]
}

export interface StaffCancelArgs {
  id: string
  restaurantId: string
  expectedVersion: number
  actorUserId: string
  at: Date
}

export interface StaffBookingStore {
  /** The staff-visible booking (never unverified), with its open change if any. */
  find(id: string, restaurantId: string): Promise<BookingRequest | null>
  create(args: StaffCreateArgs): Promise<BookingRequest>
  /**
   * BOOK-014 W4 (spec AC-11): the booking as awaiting_deposit with its deposit
   * row (awaiting, the 'created' event by the staff user), in one transaction.
   * The phone is required (the link goes to it). Paid -> confirmed (097).
   */
  createAwaitingDeposit(args: StaffCreateArgs & { input: StaffBookingInput & { phone: string } }, hold: NewDepositHold): Promise<{ booking: BookingRequest; deposit: BookingDeposit }>
  /** Null when nothing changed (stale, wrong status, open change, other tenant). */
  update(args: StaffUpdateArgs): Promise<BookingRequest | null>
  cancel(args: StaffCancelArgs): Promise<BookingRequest | null>
  /** R11: true for the one caller that may message this diner now (none in the last `gapMs`). */
  claimStaffMessage(id: string, restaurantId: string, at: Date, gapMs: number): Promise<boolean>
}

export interface CheckInArgs {
  id: string
  restaurantId: string
  today: string
  actorUserId: string
  at: Date
}

export interface CheckinStore {
  /** Today's (HK) pending, confirmed and no-show bookings by time; reads one past `cap` (R12). */
  listForDate(restaurantId: string, date: string, cap: number): Promise<{ bookings: BookingRequest[]; truncated: boolean }>
  find(id: string, restaurantId: string): Promise<BookingRequest | null>
  checkIn(args: CheckInArgs): Promise<BookingRequest | null>
  undoCheckIn(args: { id: string; restaurantId: string; actorUserId: string }): Promise<BookingRequest | null>
}
