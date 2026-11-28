// BOOK-014 W6a (spec AC-3; threat R61): the /b page states the deposit terms
// (depositTermsText: the amount rule plus the admin's refund note, zh-HK then
// en) whenever a deposit applies, on both the BOOK-001 form and the slot form;
// and its collection statement uses the one shared processing sentence
// (depositProcessingSentence), the same wording as the agent channels.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/domain/value-objects/deposit-messages', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/domain/value-objects/deposit-messages')>()
  return { ...real, depositProcessingSentence: (name: string) => ({ zh_hk: `SHARED-ZH:${name}`, en: `SHARED-EN:${name}` }) }
})

import { BookingForm } from '../booking-form'
import { DepositTerms } from '../deposit-line'
import { CollectionStatement } from '../collection-statement'
import { depositPlanOf } from '@/domain/value-objects/deposit-plan'
import { depositTermsText } from '@/domain/value-objects/deposit-terms'
import type { DepositRule } from '@/domain/value-objects/deposit-rule'

const RULE: DepositRule = {
  enabled: true,
  mode: 'per_guest',
  amount: 100,
  fromPartySize: 6,
  refundNote: { zh_hk: '取消須提前24小時，否則訂金不退。', en: 'Cancel 24 hours ahead or the deposit is kept.' },
}

describe('W6a /b deposit terms (AC-3)', () => {
  it('depositPlanOf carries depositTermsText for both languages', () => {
    const plan = depositPlanOf(RULE, 'HKD')
    expect(plan.terms).toEqual({ zh_hk: depositTermsText(RULE, 'HKD', 'zh_hk'), en: depositTermsText(RULE, 'HKD', 'en') })
    expect(plan.terms?.en).toBe('Deposit HK$100 per guest for 6 or more. Cancel 24 hours ahead or the deposit is kept.')
    expect(plan.terms?.zh_hk).toBe('訂金每位 HK$100（6位或以上）。取消須提前24小時，否則訂金不退。')
  })

  it('DepositTerms shows both languages, zh-HK first, in booking-deposit-terms; no plan -> nothing', () => {
    const html = renderToStaticMarkup(<DepositTerms plan={depositPlanOf(RULE, 'HKD')} />)
    expect(html).toContain('data-testid="booking-deposit-terms"')
    const zh = html.indexOf('訂金每位 HK$100（6位或以上）')
    const en = html.indexOf('Deposit HK$100 per guest for 6 or more.')
    expect(zh).toBeGreaterThan(-1)
    expect(en).toBeGreaterThan(zh)
    expect(html).toContain('lang="zh-HK"')
    expect(renderToStaticMarkup(<DepositTerms plan={null} />)).toBe('')
  })

  it('the BOOK-001 form shows the deposit terms while a deposit applies, even before the party reaches N', () => {
    const props = { token: 'tok', maskedPhone: '•••• 4567', today: '2026-12-01', maxPartySize: 20, retryUrl: null }
    const html = renderToStaticMarkup(<BookingForm {...props} deposit={depositPlanOf(RULE, 'HKD')} />)
    expect(html).toContain('data-testid="booking-deposit-terms"')
    expect(html).toContain('Cancel 24 hours ahead or the deposit is kept.')
    expect(renderToStaticMarkup(<BookingForm {...props} />)).not.toContain('booking-deposit-terms')
  })
})

describe('W6a R61: the /b collection statement uses the shared processing sentence', () => {
  it('renders depositProcessingSentence(restaurantName) for both languages', () => {
    const html = renderToStaticMarkup(<CollectionStatement restaurantName="Café A" deposit />)
    expect(html).toContain('SHARED-ZH:Café A')
    expect(html).toContain('SHARED-EN:Café A')
    expect(renderToStaticMarkup(<CollectionStatement restaurantName="Café A" />)).not.toContain('SHARED-')
  })
})
