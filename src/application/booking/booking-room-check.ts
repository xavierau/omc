/**
 * BOOK-010 (spec S2): the room half of the shared rule check, as every
 * channel uses it (booking page, PAP, AI tools).
 *
 * - `earlyFull`: read the counts and stops, answer `full` before anything is
 *   written (propose tools, the page's and PAP's server-side checks).
 * - `insertWithRoom`: the final authority. The check and the insert are one
 *   atomic step in the database (spec AC-5); a refusal comes back `full`.
 *
 * Both refuse with field code `full` on `time` and up to 3 suggestions that
 * fit the same party (the refused time itself never among them).
 */
import type { BookingRequest, NewBookingRequest } from '@/domain/entities/booking-request'
import type { BookingRoomReader, BookingRoomStore } from '@/domain/ports/booking'
import { suggestTimes, windowEnd, type BookingClock, type SuggestedTime } from '@/domain/services/booking-hours'
import { fitsFor, roomCheckFor, roomFor, type RoomRefusal, type RoomRequest, type RoomState, type SlotFits } from '@/domain/services/booking-room'
import type { BookingHours } from '@/domain/value-objects/booking-hours'

export interface RoomContext {
  restaurantId: string
  hours: BookingHours
  clock: BookingClock
}

export interface FullRefusal {
  errors: { time: 'full' }
  suggestedTimes: SuggestedTime[]
  refusal: RoomRefusal
}

/** The counts and stops from the asked date (or today) to the end of the booking window. */
function readWindow(reader: BookingRoomReader, ctx: RoomContext, date: string) {
  const from = date < ctx.clock.today ? ctx.clock.today : date
  const to = windowEnd(ctx.hours, ctx.clock.today)
  return reader.readRoom(ctx.restaurantId, from, to < from ? from : to)
}

/** Up to 3 times in `room` that fit the party now, the requested time excluded (spec AC-4, AC-6). */
function suggestionsIn(ctx: RoomContext, room: RoomState, req: RoomRequest): SuggestedTime[] {
  const fits = fitsFor(ctx.hours, room, req.partySize)
  const other = (date: string, time: string) => !(date === req.date && time === req.time) && fits(date, time)
  return suggestTimes(ctx.hours, req.date, req.time, ctx.clock, 3, other)
}

/** Up to 3 times that fit the party now, the requested time excluded (spec AC-4, AC-6). */
export async function fittingSuggestions(reader: BookingRoomReader, ctx: RoomContext, req: RoomRequest): Promise<SuggestedTime[]> {
  return suggestionsIn(ctx, await readWindow(reader, ctx, req.date), req)
}

/** Spec AC-4: `full` + suggestions when the request does not fit now; null when it does. One room read (review P3-1). */
export async function earlyFull(reader: BookingRoomReader, ctx: RoomContext, req: RoomRequest): Promise<FullRefusal | null> {
  const room = await readWindow(reader, ctx, req.date)
  const refusal = roomFor(ctx.hours, req, room)
  return refusal ? { errors: { time: 'full' }, suggestedTimes: suggestionsIn(ctx, room, req), refusal } : null
}

/**
 * BOOK-010 F1 (review P2-1): "fits the party now" for the alternatives to a
 * slot the booking HOURS refuse. One read of every date a suggestion can fall
 * on: from the asked date when it is inside the window, else from today
 * (too_far suggests the window's last times, or the earliest).
 */
export async function suggestionFits(reader: BookingRoomReader, ctx: RoomContext, req: { date: string; partySize: number }): Promise<SlotFits> {
  const end = windowEnd(ctx.hours, ctx.clock.today)
  const from = req.date > ctx.clock.today && req.date <= end ? req.date : ctx.clock.today
  return fitsFor(ctx.hours, await reader.readRoom(ctx.restaurantId, from, end), req.partySize)
}

/** A party size for `suggestionFits` from a raw body value: a positive integer, else 1 (any room at all). */
export const suggestionParty = (raw: unknown): number => {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : 1
}

export type InsertWithRoomResult = { ok: true; booking: BookingRequest } | { ok: false; full: FullRefusal }

/** Spec AC-5: the atomic check-and-insert; a refusal becomes `full` + suggestions. */
export async function insertWithRoom(store: BookingRoomStore, ctx: RoomContext, request: NewBookingRequest): Promise<InsertWithRoomResult> {
  const check = roomCheckFor(ctx.hours, request.bookingDate, request.bookingTime)
  const result = await store.insertIfRoom(request, check)
  if (result.ok) return result
  const req = { date: request.bookingDate, time: request.bookingTime, partySize: request.partySize }
  return { ok: false, full: { errors: { time: 'full' }, suggestedTimes: await fittingSuggestions(store, ctx, req), refusal: result.refusal } }
}

/** A party-size predicate over the window's counts and stops (availability). */
export async function fitsInRange(reader: BookingRoomReader, ctx: RoomContext, range: { from: string; to: string }, partySize: number) {
  const room = await reader.readRoom(ctx.restaurantId, range.from, range.to)
  return fitsFor(ctx.hours, room, partySize)
}
