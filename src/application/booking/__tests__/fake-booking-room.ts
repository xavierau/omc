// BOOK-010: in-memory room store with the SQL's semantics (migration 092),
// written independently of the domain's roomFor: stops (day, period key,
// slot), then guests of pending + confirmed rows at the slot and in the
// period range, then the insert, all in one tick (as the advisory-locked
// function is one step). Real Postgres proves the race in
// src/infrastructure/supabase/__tests__/booking-room-race.pg.test.ts.
import type { BookingRequest, NewBookingRequest } from '@/domain/entities/booking-request'
import type { BookingRoomStore, BookingStopStore, InsertIfRoomResult } from '@/domain/ports/booking'
import type { BookingStop, GuestCounts, RoomCheck, RoomRefusal, StopTarget } from '@/domain/services/booking-room'

interface CountedRow {
  restaurantId: string
  bookingDate: string
  bookingTime: string
  partySize: number
  status: string
}

export class FakeBookingRoom implements BookingRoomStore, BookingStopStore {
  readonly stops: Array<BookingStop & { restaurantId: string }> = []
  readonly calls: string[] = []
  /** Rows to count beyond `rows()`: e.g. a second fake's table. */
  constructor(
    private readonly rows: () => CountedRow[],
    private readonly insertRow?: (request: NewBookingRequest) => Promise<BookingRequest>
  ) {}

  private counted(restaurantId: string) {
    return this.rows().filter((r) => r.restaurantId === restaurantId && (r.status === 'pending' || r.status === 'confirmed'))
  }

  async readRoom(restaurantId: string, from: string, to: string) {
    this.calls.push(`readRoom ${restaurantId} ${from}..${to}`)
    const counts: GuestCounts = {}
    for (const r of this.counted(restaurantId)) {
      if (r.bookingDate < from || r.bookingDate > to) continue
      const day = (counts[r.bookingDate] ??= {})
      day[r.bookingTime] = (day[r.bookingTime] ?? 0) + r.partySize
    }
    const stops = this.stops
      .filter((s) => s.restaurantId === restaurantId && s.date >= from && s.date <= to)
      .map((s): BookingStop => ({
        date: s.date, scope: s.scope, periodLabel: s.periodLabel, time: s.time,
        stoppedById: s.stoppedById, stoppedByName: s.stoppedByName, stoppedAt: s.stoppedAt,
      }))
    return { counts, stops }
  }

  /** Mirrors booking_room_refusal (092). */
  refusal(restaurantId: string, slot: { date: string; time: string; partySize: number }, check: RoomCheck): RoomRefusal | null {
    const mine = this.stops.filter((s) => s.restaurantId === restaurantId && s.date === slot.date)
    if (mine.some((s) => s.scope === 'day')) return { kind: 'stopped', scope: 'day' }
    if (mine.some((s) => s.scope === 'period' && s.periodLabel === check.periodKey)) return { kind: 'stopped', scope: 'period' }
    if (mine.some((s) => s.scope === 'slot' && s.time === slot.time)) return { kind: 'stopped', scope: 'slot' }
    const sameDay = this.counted(restaurantId).filter((r) => r.bookingDate === slot.date)
    const sum = (rows: CountedRow[]) => rows.reduce((n, r) => n + r.partySize, 0)
    const atSlot = sum(sameDay.filter((r) => r.bookingTime === slot.time))
    if (check.perSlot !== null && atSlot + slot.partySize > check.perSlot) {
      return { kind: 'full', scope: 'slot', guests: atSlot, limit: check.perSlot }
    }
    if (check.perMeal !== null && check.periodFirst && check.periodLast) {
      const { periodFirst: first, periodLast: last } = check
      const atMeal = sum(sameDay.filter((r) => r.bookingTime >= first && r.bookingTime <= last))
      if (atMeal + slot.partySize > check.perMeal) return { kind: 'full', scope: 'meal', guests: atMeal, limit: check.perMeal }
    }
    return null
  }

  /** The advisory lock: one insertIfRoom at a time, check and insert together. */
  private lock: Promise<unknown> = Promise.resolve()

  insertIfRoom(request: NewBookingRequest, check: RoomCheck): Promise<InsertIfRoomResult> {
    this.calls.push(`insertIfRoom ${request.restaurantId} ${request.bookingDate} ${request.bookingTime}`)
    const run = this.lock.then(() => this.checkAndInsert(request, check))
    this.lock = run.catch(() => undefined)
    return run
  }

  private async checkAndInsert(request: NewBookingRequest, check: RoomCheck): Promise<InsertIfRoomResult> {
    if (!this.insertRow) throw new Error('FakeBookingRoom: no insert')
    const refusal = this.refusal(request.restaurantId, { date: request.bookingDate, time: request.bookingTime, partySize: request.partySize }, check)
    if (refusal) return { ok: false, refusal }
    return { ok: true, booking: await this.insertRow(request) }
  }

  async add(restaurantId: string, stop: BookingStop): Promise<BookingStop> {
    this.calls.push(`addStop ${restaurantId}`)
    const stored = this.stops.find((s) => s.restaurantId === restaurantId && same(s, stop))
    if (!stored) this.stops.push({ ...stop, restaurantId })
    const row = stored ?? stop
    return {
      date: row.date, scope: row.scope, periodLabel: row.periodLabel, time: row.time,
      stoppedById: row.stoppedById, stoppedByName: row.stoppedByName, stoppedAt: row.stoppedAt,
    }
  }

  async remove(restaurantId: string, target: StopTarget) {
    this.calls.push(`removeStop ${restaurantId}`)
    const i = this.stops.findIndex((s) => s.restaurantId === restaurantId && same(s, target))
    if (i >= 0) this.stops.splice(i, 1)
  }

  /** Test setup, not a port call. */
  seedStop(restaurantId: string, stop: Partial<BookingStop> & Pick<BookingStop, 'date' | 'scope'>) {
    this.stops.push({ periodLabel: null, time: null, stoppedById: 'u1', stoppedByName: 'Amy', stoppedAt: '2026-11-20T06:02:00.000Z', ...stop, restaurantId })
  }
}

const same = (a: StopTarget, b: StopTarget) =>
  a.date === b.date && a.scope === b.scope && (a.periodLabel ?? null) === (b.periodLabel ?? null) && (a.time ?? null) === (b.time ?? null)
