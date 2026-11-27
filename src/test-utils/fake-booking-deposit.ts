// BOOK-014: in-memory deposit ports with the same rules as migration 097's
// RPCs (booking-deposits.db.test.ts proves the SQL): every transition is a
// check-and-write in one tick, so of two interleaved calls exactly one wins;
// awaiting_deposit holds seats and counts toward the per-phone cap; the lapse
// uses the "database" clock; each move appends one deposit event with its actor.
// Refund ids are kept per attempt (booking_deposit_refund_attempts) and a refund
// webhook settles only through the attempt that made its id (review finding 2).
import { randomUUID } from 'crypto'
import type { BookingRequest, BookingStatus, NewBookingRequest } from '@/domain/entities/booking-request'
import type { BookingDeposit, DepositActor, DepositStatus, NewDepositHold } from '@/domain/entities/booking-deposit'
import type { MerchantPaymentAccount } from '@/domain/entities/merchant-payment-account'
import type {
  BeginRefundArgs,
  BookingDepositStore,
  DepositBookingWriter,
  FinishRefundArgs,
  InsertWithDepositResult,
  KeepDepositArgs,
  MarkDepositPaidResult,
  MerchantPaymentAccountReader,
  PaymentLog,
  WebhookClaimStore,
} from '@/domain/ports/booking-deposit'
import type { PaymentProviderCode } from '@/domain/ports/payment-gateway'
import type { RoomCheck } from '@/domain/services/booking-room'

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

export interface FakeDepositEvent {
  depositId: string
  type: string
  actor: DepositActor['kind']
  userId: string | null
  ref: string | null
}

type StoredDeposit = BookingDeposit & { linkTokenHash: string }

const SEAT_STATUSES: readonly BookingStatus[] = ['pending', 'confirmed', 'awaiting_deposit']
const CAP_STATUSES: readonly BookingStatus[] = ['pending', 'awaiting_deposit']

export class FakeDepositLedger implements BookingDepositStore, DepositBookingWriter {
  readonly bookings = new Map<string, BookingRequest>()
  readonly deposits = new Map<string, StoredDeposit>()
  readonly events: FakeDepositEvent[] = []
  /** Seats per slot when the RoomCheck gives none. */
  defaultSlotLimit: number | null = null
  /** Throws on the next call of a method (a database error). */
  failNext: keyof BookingDepositStore | null = null
  /** deposit id -> attempt -> the refund id the provider returned for it (null until known). */
  readonly refundAttempts = new Map<string, Map<number, string | null>>()
  /** deposit id -> last change, by the "database" clock (updated_at). */
  private readonly updatedAt = new Map<string, number>()

  constructor(readonly dbNow: () => Date = () => new Date()) {}

  private touch(d: StoredDeposit) {
    this.updatedAt.set(d.id, this.dbNow().getTime())
  }

  private attemptsOf(depositId: string): Map<number, string | null> {
    let refs = this.refundAttempts.get(depositId)
    if (!refs) {
      refs = new Map()
      this.refundAttempts.set(depositId, refs)
    }
    return refs
  }

  private maybeFail(op: keyof BookingDepositStore) {
    if (this.failNext === op) {
      this.failNext = null
      throw new Error(`fake ${op} failed`)
    }
  }

  private event(d: StoredDeposit, type: string, actor: DepositActor['kind'], userId: string | null = null, ref: string | null = null) {
    this.events.push({ depositId: d.id, type, actor, userId, ref })
    this.touch(d)
  }

  private copy(d: StoredDeposit): BookingDeposit {
    const { linkTokenHash: _hash, ...rest } = d
    void _hash
    return { ...rest, amount: { ...rest.amount } }
  }

  guests(date: string, time: string, restaurantId?: string): number {
    return [...this.bookings.values()]
      .filter((b) => b.bookingDate === date && b.bookingTime === time && SEAT_STATUSES.includes(b.status) && (!restaurantId || b.restaurantId === restaurantId))
      .reduce((sum, b) => sum + b.partySize, 0)
  }

  booking(id: string): BookingRequest | undefined {
    return this.bookings.get(id)
  }

  /** Move a booking the way another path would (decline, cancel, no-show). */
  setBookingStatus(id: string, status: BookingStatus) {
    const b = this.bookings.get(id)
    if (!b) throw new Error(`fake booking ${id} not found`)
    this.bookings.set(id, { ...b, status, decidedAt: b.decidedAt ?? new Date().toISOString() })
  }

  eventsOf(depositId: string): string[] {
    return this.events.filter((e) => e.depositId === depositId).map((e) => `${e.type}:${e.actor}`)
  }

  // ---- DepositBookingWriter ------------------------------------------------

  async insertWithDeposit(request: NewBookingRequest, check: RoomCheck, hold: NewDepositHold, maxPending: number | null): Promise<InsertWithDepositResult> {
    await tick()
    const all = [...this.bookings.values()].filter((b) => b.restaurantId === request.restaurantId)
    if (maxPending !== null && all.filter((b) => b.phone === request.phone && CAP_STATUSES.includes(b.status)).length >= maxPending) {
      return { ok: false, refusal: { kind: 'pending_cap' } }
    }
    const limit = check.perSlot ?? this.defaultSlotLimit
    const guests = this.guests(request.bookingDate, request.bookingTime, request.restaurantId)
    if (limit !== null && guests + request.partySize > limit) {
      return { ok: false, refusal: { kind: 'full', scope: 'slot', guests, limit } }
    }
    const booking: BookingRequest = {
      id: randomUUID(), restaurantId: request.restaurantId, memberId: request.memberId, phone: request.phone, name: request.name,
      partySize: request.partySize, bookingDate: request.bookingDate, bookingTime: request.bookingTime, notes: request.notes,
      status: 'awaiting_deposit', declineReason: null, decidedBy: null, decidedAt: null, source: request.source,
      campaignId: request.campaignId, createdAt: new Date().toISOString(), decisionMessageStatus: null,
    }
    const deposit: StoredDeposit = {
      id: hold.id, restaurantId: request.restaurantId, bookingId: booking.id, providerCode: hold.providerCode, accountId: hold.accountId,
      providerAccountId: hold.providerAccountId, amount: { ...hold.amount }, status: 'awaiting', holdExpiresAt: hold.holdExpiresAt,
      providerSessionId: null, sessionUrl: null, providerPaymentRef: null, paidAt: null, refundRef: null, refundReason: null,
      refundAttempts: 0, decidedBy: null, decidedAt: null, createdAt: new Date().toISOString(), linkTokenHash: hold.linkTokenHash,
    }
    if ([...this.deposits.values()].some((d) => d.linkTokenHash === hold.linkTokenHash || d.id === hold.id)) throw new Error('fake unique violation')
    this.bookings.set(booking.id, booking)
    this.deposits.set(deposit.id, deposit)
    this.event(deposit, 'created', 'system')
    return { ok: true, booking: { ...booking }, deposit: this.copy(deposit) }
  }

  /** A staff-made hold (W4 writes these; tests seed them). */
  seedStaffHold(args: { restaurantId: string; createdBy: string; hold: NewDepositHold; partySize?: number }): { booking: BookingRequest; deposit: BookingDeposit } {
    const booking: BookingRequest = {
      id: randomUUID(), restaurantId: args.restaurantId, memberId: null, phone: '+85290000000', name: 'staff', partySize: args.partySize ?? 2,
      bookingDate: '2026-12-24', bookingTime: '19:00', notes: null, status: 'awaiting_deposit', declineReason: null, decidedBy: null,
      decidedAt: null, source: 'staff', campaignId: null, createdAt: new Date().toISOString(), decisionMessageStatus: null, createdBy: args.createdBy,
    }
    const deposit: StoredDeposit = {
      id: args.hold.id, restaurantId: args.restaurantId, bookingId: booking.id, providerCode: args.hold.providerCode, accountId: args.hold.accountId,
      providerAccountId: args.hold.providerAccountId, amount: { ...args.hold.amount }, status: 'awaiting', holdExpiresAt: args.hold.holdExpiresAt,
      providerSessionId: null, sessionUrl: null, providerPaymentRef: null, paidAt: null, refundRef: null, refundReason: null, refundAttempts: 0,
      decidedBy: null, decidedAt: null, createdAt: new Date().toISOString(), linkTokenHash: args.hold.linkTokenHash,
    }
    this.bookings.set(booking.id, booking)
    this.deposits.set(deposit.id, deposit)
    this.event(deposit, 'created', 'system')
    return { booking: { ...booking }, deposit: this.copy(deposit) }
  }

  // ---- BookingDepositStore -------------------------------------------------

  async findBySession(providerCode: PaymentProviderCode, sessionRef: string) {
    await tick()
    const d = [...this.deposits.values()].find((x) => x.providerCode === providerCode && x.providerSessionId === sessionRef)
    return d ? this.copy(d) : null
  }

  async findByPaymentRef(providerCode: PaymentProviderCode, paymentRef: string) {
    await tick()
    const d = [...this.deposits.values()].find((x) => x.providerCode === providerCode && x.providerPaymentRef === paymentRef)
    return d ? this.copy(d) : null
  }

  async findByLinkTokenHash(hash: string) {
    await tick()
    const d = [...this.deposits.values()].find((x) => x.linkTokenHash === hash)
    return d ? this.copy(d) : null
  }

  async findByBookingForRestaurant(restaurantId: string, bookingId: string) {
    await tick()
    const d = [...this.deposits.values()].find((x) => x.restaurantId === restaurantId && x.bookingId === bookingId)
    return d ? this.copy(d) : null
  }

  async attachSession(depositId: string, session: { sessionRef: string; url: string }) {
    this.maybeFail('attachSession')
    await tick()
    const d = this.deposits.get(depositId)
    if (!d || d.status !== 'awaiting' || d.providerSessionId !== null) return null
    if ([...this.deposits.values()].some((x) => x.providerSessionId === session.sessionRef)) throw new Error('fake unique violation')
    d.providerSessionId = session.sessionRef
    d.sessionUrl = session.url
    this.event(d, 'session_created', 'system', null, session.sessionRef)
    return this.copy(d)
  }

  private lapseLocked(d: StoredDeposit, type: string, actor: DepositActor['kind']): boolean {
    const b = this.bookings.get(d.bookingId)
    if (b && b.status === 'awaiting_deposit') this.bookings.set(b.id, { ...b, status: 'lapsed' })
    if (d.status !== 'awaiting') return false
    d.status = 'lapsed'
    this.event(d, type, actor)
    return true
  }

  async abandon(depositId: string) {
    this.maybeFail('abandon')
    await tick()
    const d = this.deposits.get(depositId)
    if (!d || d.status !== 'awaiting') return null
    return this.lapseLocked(d, 'session_failed', 'system') ? this.copy(d) : null
  }

  async lapseExpired(limit: number, depositId?: string) {
    this.maybeFail('lapseExpired')
    await tick()
    const now = this.dbNow().getTime()
    const due = [...this.deposits.values()]
      .filter((d) => d.status === 'awaiting' && Date.parse(d.holdExpiresAt) < now && (!depositId || d.id === depositId))
      .sort((a, b) => a.holdExpiresAt.localeCompare(b.holdExpiresAt))
      .slice(0, Math.max(limit, 0))
    return due.filter((d) => this.lapseLocked(d, 'lapsed', 'cron')).map((d) => this.copy(d))
  }

  async markPaid(args: { depositId: string; paymentRef: string; at: Date }): Promise<MarkDepositPaidResult> {
    this.maybeFail('markPaid')
    await tick()
    const d = this.deposits.get(args.depositId)
    if (!d) return { outcome: 'not_found' }
    if (d.status === 'awaiting') {
      const b = this.bookings.get(d.bookingId)
      if (b && b.status === 'awaiting_deposit') {
        const staff = b.source === 'staff'
        const booking: BookingRequest = {
          ...b,
          status: staff ? 'confirmed' : 'pending',
          decidedAt: staff ? args.at.toISOString() : null,
          decidedBy: staff ? (b.createdBy ?? null) : null,
        }
        this.bookings.set(b.id, booking)
        d.status = 'paid'
        d.providerPaymentRef = args.paymentRef
        d.paidAt = args.at.toISOString()
        this.event(d, 'paid', 'provider', null, args.paymentRef)
        return { outcome: 'paid', deposit: this.copy(d), booking: { ...booking } }
      }
      this.lapseLocked(d, 'lapsed', 'system')
    }
    if (d.status === 'lapsed' && d.providerPaymentRef === null) {
      d.status = 'refund_pending'
      d.refundReason = 'late_payment'
      d.providerPaymentRef = args.paymentRef
      d.paidAt = args.at.toISOString()
      d.refundAttempts += 1
      this.attemptsOf(d.id).set(d.refundAttempts, null)
      this.event(d, 'late_payment', 'provider', null, args.paymentRef)
      this.event(d, 'refund_requested', 'system')
      return { outcome: 'late', deposit: this.copy(d) }
    }
    return { outcome: 'duplicate', deposit: this.copy(d) }
  }

  async beginRefund(args: BeginRefundArgs) {
    this.maybeFail('beginRefund')
    await tick()
    const d = this.deposits.get(args.depositId)
    if (!d || d.restaurantId !== args.restaurantId || d.status !== args.from) return null
    if (args.from === 'paid') {
      const b = this.bookings.get(d.bookingId)
      if (!b || b.restaurantId !== args.restaurantId || !args.bookingStatuses.includes(b.status)) return null
      d.refundReason = args.reason
      d.decidedBy = args.actor.kind === 'user' ? args.actor.userId : null
      d.decidedAt = args.at.toISOString()
    }
    d.status = 'refund_pending'
    d.refundAttempts += 1
    d.refundRef = null
    this.attemptsOf(d.id).set(d.refundAttempts, null)
    this.event(d, 'refund_requested', args.actor.kind, args.actor.kind === 'user' ? args.actor.userId : null)
    return this.copy(d)
  }

  async finishRefund(args: FinishRefundArgs) {
    this.maybeFail('finishRefund')
    await tick()
    const d = this.deposits.get(args.depositId)
    if (!d) return null
    const refs = this.attemptsOf(d.id)
    const settleable = d.status === 'refund_pending' || d.status === 'refund_failed'
    if (args.attempt !== null) {
      // The refund call of that attempt: records its id, settles only while it is the current attempt.
      if (args.refundRef !== null && !refs.get(args.attempt)) refs.set(args.attempt, args.refundRef)
      if (d.status !== 'refund_pending' || d.refundAttempts !== args.attempt) return null
    } else if (args.refundRef === null) {
      // "The payment is fully refunded": the provider's word on money.
      if (args.outcome !== 'refunded' || !settleable) return null
    } else {
      const attempt = [...refs].find(([, ref]) => ref === args.refundRef)?.[0]
      if (attempt === undefined) return null
      if (args.outcome === 'refunded' ? !settleable : d.status !== 'refund_pending' || attempt !== d.refundAttempts) return null
    }
    d.status = args.outcome as DepositStatus
    d.refundRef = args.refundRef ?? d.refundRef
    this.event(d, args.outcome === 'refunded' ? 'refund_succeeded' : 'refund_failed', args.actor, null, args.refundRef)
    return this.copy(d)
  }

  async recordRefundRef(args: { depositId: string; attempt: number; refundRef: string }) {
    this.maybeFail('recordRefundRef')
    await tick()
    const d = this.deposits.get(args.depositId)
    if (!d) return
    const refs = this.attemptsOf(d.id)
    if (!refs.get(args.attempt)) refs.set(args.attempt, args.refundRef)
    if (d.status === 'refund_pending' && d.refundAttempts === args.attempt && d.refundRef === null) d.refundRef = args.refundRef
  }

  async listStalledRefunds(limit: number, olderThanMs: number) {
    this.maybeFail('listStalledRefunds')
    await tick()
    const cutoff = this.dbNow().getTime() - olderThanMs
    return [...this.deposits.values()]
      .filter((d) => d.status === 'refund_pending' && d.refundRef === null && (this.updatedAt.get(d.id) ?? 0) < cutoff)
      .sort((a, b) => (this.updatedAt.get(a.id) ?? 0) - (this.updatedAt.get(b.id) ?? 0))
      .slice(0, Math.max(limit, 0))
      .map((d) => this.copy(d))
  }

  async keep(args: KeepDepositArgs) {
    this.maybeFail('keep')
    await tick()
    const d = this.deposits.get(args.depositId)
    if (!d || d.restaurantId !== args.restaurantId || d.status !== 'paid') return null
    const b = this.bookings.get(d.bookingId)
    if (!b || !args.bookingStatuses.includes(b.status)) return null
    d.status = 'kept'
    d.decidedBy = args.actorUserId
    d.decidedAt = args.at.toISOString()
    this.event(d, 'kept', 'user', args.actorUserId)
    return this.copy(d)
  }
}

export class FakeAccounts implements MerchantPaymentAccountReader {
  readonly rows = new Map<string, MerchantPaymentAccount>()

  set(account: Partial<MerchantPaymentAccount> & { restaurantId: string }): MerchantPaymentAccount {
    const row: MerchantPaymentAccount = {
      id: randomUUID(), providerCode: 'test', providerAccountId: 'acct_test_A', status: 'active', chargesEnabled: true, currency: 'HKD',
      restrictionReason: null, ...account,
    }
    this.rows.set(row.restaurantId, row)
    return row
  }

  async findForRestaurant(restaurantId: string) {
    return this.rows.get(restaurantId) ?? null
  }
}

/** processed_webhooks: first claim wins; release frees the key. */
export class FakeWebhookClaims implements WebhookClaimStore {
  readonly keys = new Set<string>()
  failNextClaim = false
  releases: string[] = []

  async claim(key: string) {
    await tick()
    if (this.failNextClaim) {
      this.failNextClaim = false
      return 'error' as const
    }
    if (this.keys.has(key)) return 'duplicate' as const
    this.keys.add(key)
    return 'new' as const
  }

  async release(key: string) {
    this.releases.push(key)
    this.keys.delete(key)
  }
}

export interface LogLine {
  level: string
  event: string
  data: Record<string, unknown>
}

export function memoryLog(): { log: PaymentLog; lines: LogLine[] } {
  const lines: LogLine[] = []
  return { lines, log: (level, event, data) => void lines.push({ level, event, data: data ?? {} }) }
}
