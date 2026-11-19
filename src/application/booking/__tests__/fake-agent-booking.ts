// BOOK-003: in-memory agent booking ports with the SQL's semantics: the
// partial unique indexes (code among unverified rows, idempotency key) and
// promotion as one conditional UPDATE (status unverified, sender phone, code,
// unexpired). Real Postgres proves the same in agent-booking.db.test.ts.
import { randomUUID } from 'crypto'
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from '@/domain/value-objects/booking-config'
import type { AgentBooking, BookingRequest, NewAgentBooking } from '@/domain/entities/booking-request'
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
    const hits = this.rows.filter(
      (r) =>
        r.restaurantId === args.restaurantId && r.phone === args.phone && r.status === 'unverified' &&
        r.confirmCode !== null && args.codes.includes(r.confirmCode) && Date.parse(r.verifyExpiresAt ?? '') > args.at.getTime()
    )
    for (const r of hits) Object.assign(r, { status: 'pending', verifiedAt: at, verifiedWamid: args.wamid, confirmCode: null })
    return hits.map((r) => ({ ...r }))
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
