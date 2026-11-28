/**
 * BOOK-014 W2 (spec AC-16): an in-memory MerchantPaymentAccountStore with the
 * Supabase adapter's rules (one row per restaurant and provider, one
 * restaurant per provider account id, status writes only while the row still
 * holds the provider account id the writer saw; W6-fix F6: an account event
 * older than the last one applied changes nothing). Tests only; never wired in
 * production (payment-deps.ts uses the Supabase repository).
 */
import { randomUUID } from 'node:crypto'
import type { MerchantAccountUpdate, MerchantPaymentAccount } from '@/domain/entities/merchant-payment-account'
import type { MerchantPaymentAccountStore } from '@/domain/ports/booking-deposit'
import type { PaymentProviderCode } from '@/domain/ports/payment-gateway'

export class MemoryMerchantAccountStore implements MerchantPaymentAccountStore {
  readonly rows = new Map<string, MerchantPaymentAccount>()
  /** Observes writes, in order ('link_account' | 'relink_account' | 'apply_status'). */
  onWrite: ((op: string) => void) | null = null

  seed(account: Partial<MerchantPaymentAccount> & { restaurantId: string }): MerchantPaymentAccount {
    const row: MerchantPaymentAccount = {
      id: randomUUID(), providerCode: 'test', providerAccountId: null, status: 'pending', chargesEnabled: false, currency: null,
      restrictionReason: null, ...account,
    }
    this.rows.set(row.id, row)
    return { ...row }
  }

  private all() {
    return [...this.rows.values()]
  }

  async findForRestaurant(restaurantId: string) {
    const mine = this.all().filter((r) => r.restaurantId === restaurantId)
    const row = mine.find((r) => r.status === 'active') ?? mine[0]
    return row ? { ...row } : null
  }

  async findForRestaurantByProvider(restaurantId: string, providerCode: PaymentProviderCode) {
    const row = this.all().find((r) => r.restaurantId === restaurantId && r.providerCode === providerCode)
    return row ? { ...row } : null
  }

  async findByProviderAccount(providerCode: PaymentProviderCode, providerAccountId: string) {
    const row = this.all().find((r) => r.providerCode === providerCode && r.providerAccountId === providerAccountId)
    return row ? { ...row } : null
  }

  async link(input: { restaurantId: string; providerCode: PaymentProviderCode; providerAccountId: string }) {
    this.onWrite?.('link_account')
    const existing = await this.findForRestaurantByProvider(input.restaurantId, input.providerCode)
    if (existing) return existing
    if (await this.findByProviderAccount(input.providerCode, input.providerAccountId)) throw new Error('provider account already linked')
    return this.seed({ ...input })
  }

  async relink(input: { restaurantId: string; accountId: string; providerAccountId: string }) {
    this.onWrite?.('relink_account')
    const row = this.rows.get(input.accountId)
    if (!row || row.restaurantId !== input.restaurantId || (row.status !== 'disabled' && row.providerAccountId !== null)) return null
    Object.assign(row, { providerAccountId: input.providerAccountId, status: 'pending', chargesEnabled: false, currency: null, restrictionReason: null })
    return { ...row }
  }

  /** W6-fix F6: last_webhook_at per account id (the event time of the last account event applied). */
  readonly lastWebhookAt = new Map<string, number>()

  async applyStatus(input: { accountId: string; providerAccountId: string; update: MerchantAccountUpdate; at: Date; eventAt?: Date }) {
    this.onWrite?.('apply_status')
    const row = this.rows.get(input.accountId)
    if (!row || row.providerAccountId !== input.providerAccountId) return null
    if (input.eventAt) {
      const last = this.lastWebhookAt.get(row.id)
      if (last !== undefined && last > input.eventAt.getTime()) return null
      this.lastWebhookAt.set(row.id, input.eventAt.getTime())
    }
    const { status, chargesEnabled, currency, restrictionReason } = input.update
    Object.assign(row, { status, chargesEnabled, currency, restrictionReason })
    return { ...row }
  }
}
