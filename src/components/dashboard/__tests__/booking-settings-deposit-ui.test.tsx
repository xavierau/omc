// BOOK-014 W2 (spec S1 AC-1/AC-2, S2 AC-3/AC-4, UI Feedback States):
// Settings → Booking gets a Payments block (status chip, Connect Stripe /
// Continue setup for admins) and a Deposit block (switch locked with
// "Connect Stripe first" until the account is active, paused warning when a
// rule is on and the account is not, the fields, the diner line).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
}))
vi.mock('@/hooks/use-booking-availability', () => ({
  useBookingSettingsSummaryState: () => ({ loading: false, summary: null }),
  parseTemplateStatuses: () => null,
}))
vi.mock('@/hooks/use-booking-template-overview', () => ({
  useBookingTemplateOverview: () => ({ templates: null, editor: null, editingKind: null, toggle: () => {}, close: () => {}, onSaved: () => {} }),
}))
const payments = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('@/hooks/use-payment-account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-payment-account')>()
  return { ...actual, usePaymentAccount: () => payments.value }
})

import { BookingSettingsSection } from '../booking-settings-section'
import { DepositErrors } from '../booking-settings/deposit-summary'
import { paymentChip, parsePaymentAccount, reasonKey } from '@/hooks/use-payment-account'
import { depositRuleOf, saveOutcome, toForm, toPayload } from '@/hooks/use-booking-settings'
import { DEFAULT_BOOKING_CONFIG, parseBookingSettings, type BookingConfig } from '@/domain/value-objects/booking-config'
import type { DepositRule } from '@/domain/value-objects/deposit-rule'
import type { PaymentAccountView } from '@/application/payments/payment-account'

const RULE: DepositRule = { enabled: true, mode: 'per_guest', amount: 100, fromPartySize: 6, refundNote: { zh_hk: '不設退款', en: 'No refunds' } }
const view = (status: PaymentAccountView['status'], patch: Partial<PaymentAccountView> = {}): PaymentAccountView => ({
  provider: 'stripe', status, chargesEnabled: status === 'active', currency: status === 'active' ? 'HKD' : null, restrictionReason: null, ...patch,
})
function setPayments(account: PaymentAccountView | null, patch: Record<string, unknown> = {}) {
  payments.value = {
    loading: false, loadFailed: false, account, canManage: true, chip: paymentChip(account), connecting: false, connectError: null, connect: () => {}, ...patch,
  }
}
const simple = (patch: Partial<BookingConfig> = {}): BookingConfig => ({ ...structuredClone(DEFAULT_BOOKING_CONFIG), mode: 'simple', ...patch })
const render = (config: BookingConfig = simple()) => renderToStaticMarkup(<BookingSettingsSection initialConfig={config} />)
const toggleTag = (html: string) => /<button[^>]*data-testid="booking-settings-deposit-toggle"[^>]*>/.exec(html)?.[0] ?? ''

beforeEach(() => setPayments(null))

describe('Payments block (AC-1, AC-2)', () => {
  it('no account: chip "Not connected", admin gets Connect Stripe', () => {
    const html = render()
    expect(html).toMatch(/data-testid="booking-settings-payment-status"[^>]*>bookingSettings\.payments\.status\.none</)
    expect(html).toMatch(/data-testid="booking-settings-payment-connect"[^>]*>bookingSettings\.payments\.connect</)
  })

  it('pending: Connecting with Continue setup', () => {
    setPayments(view('pending'))
    const html = render()
    expect(html).toContain('bookingSettings.payments.status.connecting')
    expect(html).toMatch(/data-testid="booking-settings-payment-connect"[^>]*>bookingSettings\.payments\.continue</)
  })

  it('restricted: Action needed + the reason, Continue setup', () => {
    setPayments(view('restricted', { restrictionReason: 'requirements.past_due' }))
    const html = render()
    expect(html).toContain('bookingSettings.payments.status.action_needed')
    expect(html).toContain('data-testid="booking-settings-payment-reason"')
    expect(html).toContain('bookingSettings.payments.continue')
  })

  it('active: chip Active and no connect button', () => {
    setPayments(view('active'))
    const html = render()
    expect(html).toContain('bookingSettings.payments.status.active')
    expect(html).not.toContain('booking-settings-payment-connect')
  })

  it('a non-admin sees the status but no connect button (AC-2)', () => {
    setPayments(view('pending'), { canManage: false })
    const html = render()
    expect(html).toContain('booking-settings-payment-status')
    expect(html).not.toContain('booking-settings-payment-connect')
    expect(html).toContain('bookingSettings.payments.adminOnly')
  })

  it('the connect error reads "Couldn\'t reach Stripe"', () => {
    setPayments(null, { connectError: 'provider_unavailable' })
    expect(render()).toMatch(/data-testid="booking-settings-payment-error"[^>]*>bookingSettings\.payments\.connectFailed</)
  })

  it('outside Simple mode neither block shows', () => {
    const html = render(simple({ mode: 'off' }))
    expect(html).not.toContain('booking-settings-payments')
    expect(html).not.toContain('booking-settings-deposit-toggle')
  })
})

describe('Deposit block (AC-3, AC-4)', () => {
  it('account not active and rule off: switch disabled with "Connect Stripe first"', () => {
    const html = render()
    expect(toggleTag(html)).toContain('disabled=""')
    expect(html).toContain('bookingSettings.deposit.connectFirst')
  })

  it('while the status loads the switch stays locked and no paused warning flashes', () => {
    setPayments(null, { loading: true })
    const html = render(simple({ deposit: RULE }))
    expect(html).not.toContain('booking-settings-deposit-paused')
  })

  it('active account: switch enabled; with a rule, the fields and the diner line in both languages', () => {
    setPayments(view('active'))
    const html = render(simple({ deposit: RULE }))
    expect(toggleTag(html)).not.toContain('disabled=""')
    expect(html).toContain('data-testid="booking-settings-deposit-amount"')
    expect(html).toContain('訂金每位 HK$100（6位或以上）。不設退款')
    expect(html).toContain('Deposit HK$100 per guest for 6 or more. No refunds')
  })

  it('rule on but the account went inactive: paused warning, and the switch can still be turned off', () => {
    setPayments(view('disabled', { restrictionReason: 'deauthorized' }))
    const html = render(simple({ deposit: RULE }))
    expect(html).toContain('data-testid="booking-settings-deposit-paused"')
    expect(toggleTag(html)).not.toContain('disabled=""')
    expect(toggleTag(html)).toContain('aria-checked="true"')
  })
})

describe('deposit save errors', () => {
  it('the 409 reads "Connect Stripe first" in booking-settings-deposit-error', () => {
    expect(renderToStaticMarkup(<DepositErrors errors={{}} blocked />)).toMatch(/data-testid="booking-settings-deposit-error"[^>]*><p>bookingSettings\.deposit\.errors\.blocked</)
  })

  it('field errors from the PUT are listed with the limits', () => {
    const html = renderToStaticMarkup(<DepositErrors errors={{ 'deposit.amount': 'invalid', 'deposit.fromPartySize': 'invalid' }} blocked={false} />)
    expect(html).toContain('bookingSettings.deposit.errors.amount:{&quot;min&quot;:4,&quot;max&quot;:10000}')
    expect(html).toContain('bookingSettings.deposit.errors.fromPartySize')
  })

  it('no errors → nothing rendered', () => {
    expect(renderToStaticMarkup(<DepositErrors errors={{ 'bookingHours.terms.en': 'too_long' }} blocked={false} />)).toBe('')
  })
})

describe('deposit form ↔ payload', () => {
  it('an untouched OFF rule sends no deposit; a stored rule round-trips as numbers', () => {
    expect('deposit' in JSON.parse(JSON.stringify(toPayload(toForm(simple()))))).toBe(false)
    const payload = JSON.parse(JSON.stringify(toPayload(toForm(simple({ deposit: RULE })))))
    expect(payload.deposit).toEqual(RULE)
    const parsed = parseBookingSettings(payload, simple(), '2026-11-27')
    expect(parsed.ok && parsed.config.deposit).toEqual(RULE)
  })

  it('turning the rule on sends it; outside Simple it is left out (server keeps the stored rule)', () => {
    const form = toForm(simple())
    const on = { ...form, deposit: { ...form.deposit, enabled: true, amount: '300', mode: 'per_booking' as const } }
    expect(toPayload(on).deposit).toEqual({ enabled: true, mode: 'per_booking', amount: 300, fromPartySize: 1, refundNote: { zh_hk: '', en: '' } })
    expect(toPayload({ ...on, mode: 'off' }).deposit).toBeUndefined()
  })

  it('an amount typed as text goes as typed, so the server names the field', () => {
    const form = toForm(simple({ deposit: RULE }))
    const payload = toPayload({ ...form, deposit: { ...form.deposit, amount: '12.5' } })
    expect((payload.deposit as Record<string, unknown>).amount).toBe('12.5')
    expect(depositRuleOf({ ...form.deposit, amount: '12.5' })).toBeNull()
  })

  it('a 409 from the save is "Connect Stripe first"', () => {
    expect(saveOutcome(409, { error: 'payment_account_not_active' })).toEqual({ kind: 'deposit_blocked' })
    expect(saveOutcome(409, { error: 'other' })).toEqual({ kind: 'error' })
  })
})

describe('payment account helpers', () => {
  it('maps statuses to chips', () => {
    expect(paymentChip(null)).toBe('none')
    expect(paymentChip(view('pending'))).toBe('connecting')
    expect(paymentChip(view('active'))).toBe('active')
    expect(paymentChip(view('active', { chargesEnabled: false }))).toBe('action_needed')
    expect(paymentChip(view('restricted'))).toBe('action_needed')
    expect(paymentChip(view('disabled'))).toBe('disconnected')
  })

  it('reason keys', () => {
    expect(reasonKey('requirements.past_due')).toBe('past_due')
    expect(reasonKey('rejected.fraud')).toBe('rejected')
    expect(reasonKey('deauthorized')).toBe('deauthorized')
    expect(reasonKey('listed')).toBe('other')
    expect(reasonKey(null)).toBeNull()
  })

  it('parses the GET body and refuses malformed ones', () => {
    expect(parsePaymentAccount({ account: null, canManage: true })).toEqual({ account: null, canManage: true })
    expect(parsePaymentAccount({ account: view('active'), canManage: false })?.account?.status).toBe('active')
    expect(parsePaymentAccount({ account: { status: 'weird' }, canManage: true })).toBeNull()
    expect(parsePaymentAccount({ error: 'x' })).toBeNull()
  })
})
