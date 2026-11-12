// In-memory booking ports with the same atomicity as the SQL: a token claim
// and a pending -> decision move each succeed for exactly one caller, even
// when two calls interleave (the check and the write happen in one tick, as
// one conditional UPDATE does in Postgres; see booking.db.test.ts).
import { randomUUID } from 'crypto'
import { bookingTokenState, type BookingLinkSource } from '@/domain/services/booking-token'
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from '@/domain/value-objects/booking-config'
import type { BookingRequest, DecisionMessageStatus, NewBookingRequest } from '@/domain/entities/booking-request'
import type {
  BookingMessageInput,
  BookingMessageSender,
  BookingRequestStore,
  BookingRestaurantContext,
  BookingSendResult,
  BookingSettingsReader,
  BookingTokenStore,
  DecideBookingArgs,
} from '@/domain/ports/booking'

export interface FakeTokenRow {
  token: string
  restaurantId: string
  phone: string
  source: BookingLinkSource
  campaignId: string | null
  expiresAt: string | null
  consumedAt: string | null
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

export class FakeBookingTokens implements BookingTokenStore {
  constructor(readonly rows: FakeTokenRow[] = []) {}

  add(row: Partial<FakeTokenRow> & { token: string; restaurantId: string; phone: string }): void {
    this.rows.push({ source: 'chat', campaignId: null, expiresAt: null, consumedAt: null, ...row })
  }

  private owner(row: FakeTokenRow) {
    return { restaurantId: row.restaurantId, phone: row.phone, source: row.source, campaignId: row.campaignId }
  }

  async peek(token: string, now: Date) {
    await tick()
    const row = this.rows.find((r) => r.token === token)
    return { state: bookingTokenState(row ?? null, now), owner: row ? this.owner(row) : null }
  }

  async claim(token: string, now: Date) {
    await tick()
    const row = this.rows.find((r) => r.token === token)
    if (!row || bookingTokenState(row, now) !== 'valid') return null
    row.consumedAt = now.toISOString()
    return this.owner(row)
  }

  async release(token: string, claimedAt: Date) {
    const row = this.rows.find((r) => r.token === token && r.consumedAt === claimedAt.toISOString())
    if (row) row.consumedAt = null
  }
}

export class FakeBookingRequests implements BookingRequestStore {
  readonly rows: Array<BookingRequest & { token: string | null }> = []
  failInsert = false
  failRecordDecisionMessage = false

  async insert(request: NewBookingRequest): Promise<BookingRequest> {
    await tick()
    if (this.failInsert) throw new Error('insert failed')
    if (this.rows.some((r) => r.token === request.token)) throw new Error('duplicate key booking_requests_token_key')
    const { token, ...rest } = request
    const row = {
      ...rest, token, id: randomUUID(), status: 'pending' as const, declineReason: null, decidedBy: null,
      decidedAt: null, createdAt: new Date(Date.now() + this.rows.length).toISOString(), decisionMessageStatus: null,
    }
    this.rows.push(row)
    return row
  }

  async countPending(restaurantId: string, phone: string) {
    return this.rows.filter((r) => r.restaurantId === restaurantId && r.phone === phone && r.status === 'pending').length
  }

  /** Every pending row plus the newest `decidedLimit` decided ones, newest first (F10). */
  async listForRestaurant(restaurantId: string, decidedLimit: number) {
    const newestFirst = this.rows
      .filter((r) => r.restaurantId === restaurantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const decided = new Set(newestFirst.filter((r) => r.status !== 'pending').slice(0, decidedLimit))
    return newestFirst.filter((r) => r.status === 'pending' || decided.has(r)).map((r) => ({ ...r }))
  }

  async recordDecisionMessage(id: string, restaurantId: string, status: DecisionMessageStatus) {
    if (this.failRecordDecisionMessage) throw new Error('update failed')
    const row = this.rows.find((r) => r.id === id && r.restaurantId === restaurantId)
    if (row) row.decisionMessageStatus = status
  }

  async findForRestaurant(id: string, restaurantId: string) {
    return this.rows.find((r) => r.id === id && r.restaurantId === restaurantId) ?? null
  }

  async decide(args: DecideBookingArgs) {
    await tick()
    const row = this.rows.find((r) => r.id === args.id && r.restaurantId === args.restaurantId && r.status === 'pending')
    if (!row) return null
    Object.assign(row, {
      status: args.decision, decidedBy: args.decidedBy, decidedAt: args.decidedAt.toISOString(),
      declineReason: args.decision === 'declined' ? args.declineReason : null,
    })
    return { ...row }
  }
}

export class FakeBookingSettings implements BookingSettingsReader {
  configs = new Map<string, BookingConfig>()
  restaurants = new Map<string, BookingRestaurantContext>()
  campaignUrls = new Map<string, { restaurantId: string; url: string }>()

  setConfig(restaurantId: string, patch: Partial<BookingConfig>): void {
    this.configs.set(restaurantId, { ...DEFAULT_BOOKING_CONFIG, ...patch })
  }

  async getConfig(restaurantId: string) {
    return this.configs.get(restaurantId) ?? { ...DEFAULT_BOOKING_CONFIG }
  }

  async getRestaurant(restaurantId: string) {
    return this.restaurants.get(restaurantId) ?? null
  }

  async getCampaignBookingUrl(campaignId: string, restaurantId: string) {
    const entry = this.campaignUrls.get(campaignId)
    return entry && entry.restaurantId === restaurantId ? entry.url : null
  }
}

export class FakeBookingSender implements BookingMessageSender {
  readonly sent: BookingMessageInput[] = []
  result: BookingSendResult = { delivered: true, via: 'text' }

  async send(input: BookingMessageInput) {
    this.sent.push(input)
    return this.result
  }
}
