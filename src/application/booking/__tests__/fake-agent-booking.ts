// BOOK-003: in-memory agent booking ports with the SQL's semantics: the
// partial unique indexes (code among unverified rows, idempotency key) and
// promotion as one conditional step (status unverified, sender phone, code,
// unexpired, and room under the phone's pending cap, review F1). Real Postgres
// proves the same in agent-booking.db.test.ts. `rows` stands for the whole
// booking_requests table, so it may hold BOOK-001 chat/campaign rows too.
import { randomUUID } from 'crypto'
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from '@/domain/value-objects/booking-config'
import type { AgentBooking, BookingRequest, NewAgentBooking } from '@/domain/entities/booking-request'
import type { RoomCheck, RoomRefusal } from '@/domain/services/booking-room'
import type {
  AgentBookingDirectory,
  AgentBookingStore,
  InsertAgentBookingResult,
  PromoteAgentBookingArgs,
  UnverifiedBookingPurgeStore,
} from '@/domain/ports/booking'

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

export class FakeAgentBookingStore implements AgentBookingStore, UnverifiedBookingPurgeStore {
  readonly rows: AgentBooking[] = []
  /** Every call, by method name, so tests can prove what was (not) written (R42). */
  readonly calls: string[] = []
  createdAt: () => Date = () => new Date()
  /** BOOK-010: the room check promote_agent_booking_with_room runs per candidate (set by tests that use room). */
  roomRefusal?: (restaurantId: string, slot: { date: string; time: string; partySize: number }, check: RoomCheck) => RoomRefusal | null

  async insert(b: NewAgentBooking): Promise<InsertAgentBookingResult> {
    this.calls.push('insert')
    await tick()
    const same = (r: AgentBooking) => r.restaurantId === b.restaurantId
    if (b.idempotencyKey && this.rows.some((r) => same(r) && r.idempotencyKey === b.idempotencyKey)) {
      return { ok: false, conflict: 'idempotency_key' }
    }
    if (this.rows.some((r) => same(r) && r.status === 'unverified' && r.confirmCode === b.confirmCode)) {
      return { ok: false, conflict: 'confirm_code' }
    }
    const row: AgentBooking = {
      id: randomUUID(), restaurantId: b.restaurantId, memberId: null, phone: b.phone, name: b.name, partySize: b.partySize,
      bookingDate: b.bookingDate, bookingTime: b.bookingTime, notes: b.notes, status: 'unverified', declineReason: null,
      decidedBy: null, decidedAt: null, source: 'agent', campaignId: null, createdAt: this.createdAt().toISOString(),
      decisionMessageStatus: null, confirmCode: b.confirmCode, verifyExpiresAt: b.verifyExpiresAt, verifiedAt: null,
      verifiedWamid: null, statusTokenHash: b.statusTokenHash, idempotencyKey: b.idempotencyKey,
      ...(b.termsAcceptedAt ? { termsAcceptedAt: b.termsAcceptedAt, termsText: b.termsText } : {}),
    }
    this.rows.push(row)
    return { ok: true, booking: { ...row } }
  }

  async countLiveUnverified(restaurantId: string, now: Date, phone?: string) {
    this.calls.push('countLiveUnverified')
    return this.rows.filter(
      (r) =>
        r.restaurantId === restaurantId && r.status === 'unverified' && Date.parse(r.verifyExpiresAt ?? '') > now.getTime() &&
        (phone === undefined || r.phone === phone)
    ).length
  }

  async countPending(restaurantId: string, phone: string) {
    this.calls.push('countPending')
    return this.rows.filter((r) => r.restaurantId === restaurantId && r.phone === phone && r.status === 'pending').length
  }

  /** Test setup, not a port call: a pending booking (any source) already in the table. */
  seedPending(restaurantId: string, phone: string, source: AgentBooking['source']) {
    this.rows.push({
      id: randomUUID(), restaurantId, memberId: null, phone, name: 'Seeded', partySize: 2, bookingDate: '2026-11-20',
      bookingTime: '19:00', notes: null, status: 'pending', declineReason: null, decidedBy: null, decidedAt: null, source,
      campaignId: null, createdAt: this.createdAt().toISOString(), decisionMessageStatus: null, confirmCode: null,
      verifyExpiresAt: null, verifiedAt: null, verifiedWamid: null, statusTokenHash: null, idempotencyKey: null,
    })
  }

  /** Test setup, not a port call: a live unverified agent booking already in the table. */
  seedUnverified(restaurantId: string, phone: string, verifyExpiresAt: string) {
    this.rows.push({
      id: randomUUID(), restaurantId, memberId: null, phone, name: 'Seeded', partySize: 2, bookingDate: '2026-11-20',
      bookingTime: '19:00', notes: null, status: 'unverified', declineReason: null, decidedBy: null, decidedAt: null,
      source: 'agent', campaignId: null, createdAt: this.createdAt().toISOString(), decisionMessageStatus: null,
      confirmCode: null, verifyExpiresAt, verifiedAt: null, verifiedWamid: null, statusTokenHash: null, idempotencyKey: null,
    })
  }

  async findByIdempotencyKey(restaurantId: string, key: string) {
    this.calls.push('findByIdempotencyKey')
    const row = this.rows.find((r) => r.restaurantId === restaurantId && r.idempotencyKey === key)
    return row ? { ...row } : null
  }

  async find(id: string, restaurantId: string) {
    this.calls.push('find')
    const row = this.rows.find((r) => r.id === id && r.restaurantId === restaurantId && r.source === 'agent')
    return row ? { ...row } : null
  }

  async replaceStatusToken(id: string, restaurantId: string, hash: string) {
    this.calls.push('replaceStatusToken')
    const row = this.rows.find((r) => r.id === id && r.restaurantId === restaurantId)
    if (row) row.statusTokenHash = hash
  }

  async promote(args: PromoteAgentBookingArgs): Promise<BookingRequest[]> {
    this.calls.push('promote')
    await tick()
    const at = args.at.toISOString()
    const pending = this.rows.filter(
      (r) => r.restaurantId === args.restaurantId && r.phone === args.phone && r.status === 'pending'
    ).length
    const room = Math.max(0, args.maxPending - pending)
    const candidates = this.rows.filter(
      (r) =>
        r.restaurantId === args.restaurantId && r.phone === args.phone && r.status === 'unverified' &&
        r.confirmCode !== null && args.codes.includes(r.confirmCode) && Date.parse(r.verifyExpiresAt ?? '') > args.at.getTime()
    )
    if (!args.room) {
      const hits = candidates.slice(0, room)
      for (const r of hits) Object.assign(r, { status: 'pending', verifiedAt: at, verifiedWamid: args.wamid, confirmCode: null })
      return hits.map((r) => ({ ...r }))
    }
    return this.promoteWithRoom(args, candidates, room)
  }

  /** BOOK-010: mirrors promote_agent_booking_with_room (092): no room → declined 'full'; else pending while the cap allows. */
  private promoteWithRoom(args: PromoteAgentBookingArgs, candidates: AgentBooking[], cap: number): BookingRequest[] {
    const at = args.at.toISOString()
    const changed: AgentBooking[] = []
    for (const r of candidates) {
      const check = args.room?.({ date: r.bookingDate, time: r.bookingTime })
      const refusal = check ? this.roomRefusal?.(r.restaurantId, { date: r.bookingDate, time: r.bookingTime, partySize: r.partySize }, check) : null
      if (refusal) {
        Object.assign(r, { status: 'declined', declineReason: 'full', decidedAt: at, decidedBy: null, verifiedAt: at, verifiedWamid: args.wamid, confirmCode: null })
        changed.push(r)
      } else if (cap > 0) {
        Object.assign(r, { status: 'pending', verifiedAt: at, verifiedWamid: args.wamid, confirmCode: null })
        cap--
        changed.push(r)
      }
    }
    return changed.map((r) => ({ ...r }))
  }

  /** BOOK-009 F1: mirrors findPromotableAgentBookings (read only). */
  async findPromotable(args: Pick<PromoteAgentBookingArgs, 'restaurantId' | 'phone' | 'codes' | 'at'>): Promise<AgentBooking[]> {
    this.calls.push('findPromotable')
    await tick()
    return this.rows
      .filter(
        (r) =>
          r.restaurantId === args.restaurantId && r.phone === args.phone && r.status === 'unverified' &&
          r.confirmCode !== null && args.codes.includes(r.confirmCode) && Date.parse(r.verifyExpiresAt ?? '') > args.at.getTime()
      )
      .map((r) => ({ ...r }))
  }

  /** BOOK-009 F1: mirrors declineUnverifiedAgentBooking (unverified only, scoped by restaurant). */
  async declineUnverified(id: string, restaurantId: string, at: Date, reason: string) {
    this.calls.push('declineUnverified')
    await tick()
    const row = this.rows.find((r) => r.id === id && r.restaurantId === restaurantId && r.status === 'unverified')
    if (!row) return false
    Object.assign(row, { status: 'declined', declineReason: reason, decidedAt: at.toISOString(), confirmCode: null })
    return true
  }

  /** BOOK-008 R1: mirrors linkAgentBookingMember (member_id null, not unverified, scoped by restaurant). */
  failLinkMember = false
  async linkMember(id: string, restaurantId: string, memberId: string) {
    this.calls.push('linkMember')
    await tick()
    if (this.failLinkMember) throw new Error('link failed')
    const row = this.rows.find((r) => r.id === id && r.restaurantId === restaurantId && r.memberId === null && r.status !== 'unverified')
    if (!row) return false
    row.memberId = memberId
    return true
  }

  async purgeUnverified(createdBefore: Date) {
    this.calls.push('purgeUnverified')
    const doomed = this.rows.filter((r) => r.status === 'unverified' && Date.parse(r.createdAt) < createdBefore.getTime())
    for (const r of doomed) this.rows.splice(this.rows.indexOf(r), 1)
    return doomed.length
  }
}

export class FakeAgentDirectory implements AgentBookingDirectory {
  readonly tenants = new Map<string, { restaurantId: string; config: BookingConfig }>()

  add(restaurantId: string, publicId: string, patch: Partial<BookingConfig> = {}, agent: Partial<BookingConfig['agentBooking']> = {}) {
    const config: BookingConfig = {
      ...DEFAULT_BOOKING_CONFIG,
      mode: 'simple',
      ...patch,
      agentBooking: { enabled: true, publicId, websiteHost: 'www.example.hk', ...agent },
    }
    this.tenants.set(publicId, { restaurantId, config })
    return config
  }

  async findByPublicId(publicId: string) {
    return this.tenants.get(publicId) ?? null
  }
}

/** Deterministic secrets: codes from a script, tokens numbered. */
export function scriptedSecrets(codes: string[] = []) {
  let token = 0
  let id = 0
  const queue = [...codes]
  return {
    randomIndex: (() => {
      let pending: number[] = []
      return (n: number) => {
        if (pending.length === 0) {
          const code = queue.shift()
          pending = code
            ? [...code].map((c) => '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'.indexOf(c))
            : Array.from({ length: 6 }, () => Math.floor(Math.random() * n))
        }
        return pending.shift() as number
      }
    })(),
    statusToken: () => `tok${String(++token).padStart(40, 'x')}`,
    publicId: () => `pid${String(++id).padStart(29, 'y')}`,
  }
}
