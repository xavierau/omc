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
import { fitsFor, roomCheckFor, roomFor, type RoomRefusal, type RoomRequest } from '@/domain/services/booking-room'
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

/** Up to 3 times that fit the party now, the requested time excluded (spec AC-4, AC-6). */
export async function fittingSuggestions(reader: BookingRoomReader, ctx: RoomContext, req: RoomRequest): Promise<SuggestedTime[]> {
  const room = await readWindow(reader, ctx, req.date)
  const fits = fitsFor(ctx.hours, room, req.partySize)
  const other = (date: string, time: string) => !(date === req.date && time === req.time) && fits(date, time)
  return suggestTimes(ctx.hours, req.date, req.time, ctx.clock, 3, other)
}

async function fullWith(reader: BookingRoomReader, ctx: RoomContext, req: RoomRequest, refusal: RoomRefusal): Promise<FullRefusal> {
  return { errors: { time: 'full' }, suggestedTimes: await fittingSuggestions(reader, ctx, req), refusal }
}

/** Spec AC-4: `full` + suggestions when the request does not fit now; null when it does. */
export async function earlyFull(reader: BookingRoomReader, ctx: RoomContext, req: RoomRequest): Promise<FullRefusal | null> {
  const room = await readWindow(reader, ctx, req.date)
  const refusal = roomFor(ctx.hours, req, room)
  return refusal ? fullWith(reader, ctx, req, refusal) : null
}

export type InsertWithRoomResult = { ok: true; booking: BookingRequest } | { ok: false; full: FullRefusal }

/** Spec AC-5: the atomic check-and-insert; a refusal becomes `full` + suggestions. */
export async function insertWithRoom(store: BookingRoomStore, ctx: RoomContext, request: NewBookingRequest): Promise<InsertWithRoomResult> {
  const check = roomCheckFor(ctx.hours, request.bookingDate, request.bookingTime)
  const result = await store.insertIfRoom(request, check)
  if (result.ok) return result
  const req = { date: request.bookingDate, time: request.bookingTime, partySize: request.partySize }
  return { ok: false, full: await fullWith(store, ctx, req, result.refusal) }
}

/** A party-size predicate over the window's counts and stops (availability). */
export async function fitsInRange(reader: BookingRoomReader, ctx: RoomContext, range: { from: string; to: string }, partySize: number) {
  const room = await reader.readRoom(ctx.restaurantId, range.from, range.to)
  return fitsFor(ctx.hours, room, partySize)
}
