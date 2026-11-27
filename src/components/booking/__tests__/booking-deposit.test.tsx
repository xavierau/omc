// BOOK-014 W3 (spec AC-5, UI states; threat R61): the /b page with a deposit.
// The deposit line and "Pay deposit HK$X and send" only when the chosen party
// owes one; the redirect answer navigates to /p; the 503 shows
// booking-deposit-error; the collection statement names Stripe and the
// cross-border processing only when a deposit applies, in zh-HK and en.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

import { isPaymentRedirect, outcomeFromResponse } from '../booking-form-client'
import { DepositLine, DepositUnavailable, depositSubmitLabel } from '../deposit-line'
import { SummaryBar } from '../summary-bar'
import { CollectionStatement } from '../collection-statement'
import { BookingForm } from '../booking-form'
import type { DepositPlan } from '@/domain/value-objects/deposit-plan'
import zh from '@/messages/zh-HK.json'
import en from '@/messages/en.json'

const PLAN: DepositPlan = { mode: 'per_guest', amount: 100, fromPartySize: 3, currency: 'HKD' }
const t = (ns: string) => (key: string, vars?: Record<string, unknown>) => (vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`)

describe('W3: API answers with a deposit', () => {
  it('200 with a /p redirect -> redirect; 503 payment_unavailable -> payment_unavailable', () => {
    expect(outcomeFromResponse(200, { ok: true, redirect: 'https://app.example.test/p/tok' })).toEqual({ kind: 'redirect', url: 'https://app.example.test/p/tok' })
    expect(outcomeFromResponse(503, { error: 'payment_unavailable' })).toEqual({ kind: 'payment_unavailable' })
    expect(outcomeFromResponse(200, { ok: true, delivered: true })).toEqual({ kind: 'sent' })
  })

  it('a redirect that is not our /p path is never followed (shown as an error)', () => {
    for (const url of ['https://evil.example/pay', 'javascript:alert(1)', '/b/other', 'nonsense']) {
      expect(isPaymentRedirect(url)).toBe(false)
      expect(outcomeFromResponse(200, { ok: true, redirect: url })).toEqual({ kind: 'error' })
    }
    expect(isPaymentRedirect('http://localhost:3100/p/abc')).toBe(true)
  })
})

describe('W3: deposit line and button label', () => {
  it('party at or above N: the line with the amount; below N or no plan: nothing', () => {
    expect(renderToStaticMarkup(<DepositLine plan={PLAN} partySize={4} />)).toContain('booking.deposit.line:{&quot;amount&quot;:&quot;HK$400&quot;}')
    expect(renderToStaticMarkup(<DepositLine plan={PLAN} partySize={4} />)).toContain('data-testid="booking-deposit-line"')
    expect(renderToStaticMarkup(<DepositLine plan={PLAN} partySize={2} />)).toBe('')
    expect(renderToStaticMarkup(<DepositLine plan={null} partySize={4} />)).toBe('')
  })

  it('the submit reads "Pay deposit HK$X and send" only when one is owed', () => {
    expect(depositSubmitLabel(t('booking'), PLAN, 4)).toBe('booking.deposit.submit:{"amount":"HK$400"}')
    expect(depositSubmitLabel(t('booking'), PLAN, 2)).toBeNull()
    expect(depositSubmitLabel(t('booking'), PLAN, null)).toBeNull()
    expect(depositSubmitLabel(t('booking'), { ...PLAN, mode: 'per_booking', amount: 300 }, 8)).toBe('booking.deposit.submit:{"amount":"HK$300"}')
  })

  it('the slot form summary bar uses the deposit label once party, day and time are chosen', () => {
    const values = { partySize: 4, date: '2026-12-24', time: '19:00', name: 'Chan', notes: '', accepted: false }
    const html = renderToStaticMarkup(<SummaryBar values={values} missing={null} submitting={false} preview={false} deposit={PLAN} />)
    expect(html).toContain('booking.deposit.submit:{&quot;amount&quot;:&quot;HK$400&quot;}')
    expect(renderToStaticMarkup(<SummaryBar values={values} missing={null} submitting={false} preview={false} />)).toContain('booking.submit')
  })

  it('the BOOK-001 form shows the line and the label for its default party of 2 only when N <= 2', () => {
    const props = { token: 'tok', maskedPhone: '•••• 4567', today: '2026-12-01', maxPartySize: 20, retryUrl: null }
    const owed = renderToStaticMarkup(<BookingForm {...props} deposit={{ ...PLAN, fromPartySize: 1 }} />)
    expect(owed).toContain('data-testid="booking-deposit-line"')
    expect(owed).toContain('booking.deposit.submit:{&quot;amount&quot;:&quot;HK$200&quot;}')
    const none = renderToStaticMarkup(<BookingForm {...props} deposit={PLAN} />)
    expect(none).not.toContain('booking-deposit-line')
    expect(none).toContain('booking.submit')
  })

  it('the 503 state: booking-deposit-error with the WhatsApp link', () => {
    const html = renderToStaticMarkup(<DepositUnavailable retryUrl="https://wa.me/85220000001?text=BOOK" />)
    expect(html).toContain('data-testid="booking-deposit-error"')
    expect(html).toContain('role="alert"')
    expect(html).toContain('booking.deposit.unavailable')
    expect(html).toContain('href="https://wa.me/85220000001?text=BOOK"')
  })

  it('zh-HK and en copy exist for every deposit key', () => {
    for (const messages of [zh, en]) {
      const d = (messages as { booking: { deposit: Record<string, string> } }).booking.deposit
      for (const key of ['line', 'submit', 'unavailable', 'redirecting', 'continue']) expect(d[key], key).toBeTruthy()
    }
    expect(zh.booking.deposit.submit).toContain('支付訂金')
    expect(en.booking.deposit.submit).toContain('Pay deposit')
  })
})

describe('W3 R61: collection statement', () => {
  it('no deposit -> no Stripe sentence', () => {
    const html = renderToStaticMarkup(<CollectionStatement restaurantName="Café A" />)
    expect(html).not.toContain('Stripe')
    expect(html).not.toContain('data-testid="booking-collection-deposit"')
  })

  it('a deposit applies -> Stripe processes it for the restaurant, possibly outside Hong Kong, zh-HK and en', () => {
    const html = renderToStaticMarkup(<CollectionStatement restaurantName="Café A" deposit />)
    expect(html).toContain('data-testid="booking-collection-deposit"')
    expect(html).toContain('訂金由 Stripe 代Café A處理')
    expect(html).toContain('香港以外')
    expect(html).toContain('The deposit is processed by Stripe for Café A')
    expect(html).toContain('outside Hong Kong')
  })
})
