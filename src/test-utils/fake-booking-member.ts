// BOOK-008: in-memory member directory and booking ↔ member link store with
// the SQL's semantics. `relink` mirrors RPC relink_booking_member (migration
// 088): one compare-and-set step scoped by booking AND restaurant, the target
// member resolved in the same restaurant, and the events row written only
// when the row changed. Real Postgres proves the same in the AC-6 scratch log.
import { randomUUID } from 'crypto'
import { BOOKING_MEMBER_RELINKED_EVENT, type MemberBookingItem, type MemberBookingStats } from '@/domain/entities/member-booking'
import type { BookingStatus } from '@/domain/entities/booking-request'
import type { BookingMemberLookup, HongKongMoment } from '@/domain/ports/booking'
import type { BookingMemberLinkStore, MemberBookingsReader, RelinkBookingMemberArgs } from '@/domain/ports/booking-member'
import type { FakeBookingRequests } from './fake-booking'

export interface FakeMemberRow {
  id: string
  restaurantId: string
  phone: string
}

export class FakeMemberDirectory implements BookingMemberLookup {
  readonly rows: FakeMemberRow[] = []
  /** Every call by method name: the port has no way to create a member (R1). */
  readonly calls: string[] = []

  add(restaurantId: string, phone: string, id: string = randomUUID()): string {
    this.rows.push({ id, restaurantId, phone })
    return id
  }

  async findMemberId(restaurantId: string, phone: string) {
    this.calls.push('findMemberId')
    return this.rows.find((m) => m.restaurantId === restaurantId && m.phone === phone)?.id ?? null
  }

  async memberExists(memberId: string, restaurantId: string) {
    this.calls.push('memberExists')
    return this.rows.some((m) => m.id === memberId && m.restaurantId === restaurantId)
  }
}

export interface FakeEventRow {
  restaurantId: string
  memberId: string | null
  type: string
  actorUserId: string
  data: Record<string, unknown>
}

export class FakeBookingMemberLinks implements BookingMemberLinkStore {
  readonly events: FakeEventRow[] = []
  failRelink = false

  constructor(readonly requests: FakeBookingRequests, readonly members: FakeMemberDirectory) {}

  findBooking(id: string, restaurantId: string) {
    return this.requests.findForRestaurant(id, restaurantId)
  }

  memberExists(memberId: string, restaurantId: string) {
    return this.members.memberExists(memberId, restaurantId)
  }

  async relink(args: RelinkBookingMemberArgs) {
    if (this.failRelink) throw new Error('relink_booking_member failed')
    const target = args.toMemberId === null || this.members.rows.some((m) => m.id === args.toMemberId && m.restaurantId === args.restaurantId)
    const row = this.requests.rows.find(
      (r) => r.id === args.id && r.restaurantId === args.restaurantId && r.status !== 'unverified' && r.memberId === args.fromMemberId
    )
    if (!row || !target || args.toMemberId === args.fromMemberId) return null
    row.memberId = args.toMemberId
    this.events.push({
      restaurantId: args.restaurantId,
      memberId: null,
      type: BOOKING_MEMBER_RELINKED_EVENT,
      actorUserId: args.actorUserId,
      data: { bookingId: args.id, fromMemberId: args.fromMemberId, toMemberId: args.toMemberId },
    })
    return { ...row }
  }
}

export interface FakeMemberBookingRow {
  id: string
  restaurantId: string
  memberId: string | null
  bookingDate: string
  bookingTime: string
  partySize: number
  status: BookingStatus
}

const before = (r: { bookingDate: string; bookingTime: string }, now: HongKongMoment) =>
  r.bookingDate < now.date || (r.bookingDate === now.date && r.bookingTime < now.time)

/**
 * Mirrors listMemberBookings (scoped by restaurant AND member, unverified
 * excluded, newest date then time first, `limit` rows) and RPC
 * member_booking_stats (same scope, every row counted).
 */
export class FakeMemberBookings implements MemberBookingsReader {
  readonly rows: FakeMemberBookingRow[] = []
  readonly calls: unknown[][] = []
  fail = false

  private scoped(memberId: string, restaurantId: string) {
    return this.rows.filter((r) => r.memberId === memberId && r.restaurantId === restaurantId && r.status !== 'unverified')
  }

  async list(memberId: string, restaurantId: string, limit: number): Promise<MemberBookingItem[]> {
    this.calls.push(['list', memberId, restaurantId, limit])
    if (this.fail) throw new Error('list failed')
    return this.scoped(memberId, restaurantId)
      .sort((a, b) => `${b.bookingDate} ${b.bookingTime}`.localeCompare(`${a.bookingDate} ${a.bookingTime}`))
      .slice(0, limit)
      .map((r) => ({ id: r.id, bookingDate: r.bookingDate, bookingTime: r.bookingTime, partySize: r.partySize, status: r.status as MemberBookingItem['status'] }))
  }

  async stats(memberId: string, restaurantId: string, now: HongKongMoment): Promise<MemberBookingStats> {
    this.calls.push(['stats', memberId, restaurantId, now])
    const rows = this.scoped(memberId, restaurantId)
    const count = (status: BookingStatus) => rows.filter((r) => r.status === status).length
    const past = rows.filter((r) => before(r, now)).map((r) => r.bookingDate).sort()
    const next = rows.filter((r) => !before(r, now) && ['pending', 'confirmed'].includes(r.status)).map((r) => r.bookingDate).sort()
    return {
      total: rows.length, confirmed: count('confirmed'), cancelled: count('cancelled'), declined: count('declined'),
      noShow: count('no_show'), pending: count('pending'), lastBookingDate: past.at(-1) ?? null, nextBookingDate: next[0] ?? null,
    }
  }
}
