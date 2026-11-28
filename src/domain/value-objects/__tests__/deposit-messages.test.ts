// BOOK-014 W5 (threat R61, R64; spec Q5): the agent channels' fixed deposit texts, both languages.
import { describe, it, expect } from 'vitest'
import { depositDecisionText, depositLinkText, depositProcessingSentence, PAYMENT_UNAVAILABLE_TEXT } from '../deposit-messages'

const HK400 = { amountMinor: 40000, currency: 'HKD' }

describe('deposit messages', () => {
  it('R61 snapshot: the processing sentence is the booking page (W3) wording, zh-HK and en', () => {
    expect(depositProcessingSentence('Café A')).toEqual({
      zh_hk: '訂金由 Stripe 代Café A處理，Stripe 或會在香港以外地方處理你的付款資料。',
      en: 'The deposit is processed by Stripe for Café A; Stripe may process your payment details outside Hong Kong.',
    })
  })

  it('the link text: amount, pay-by, booking, link, refund rule, then R61', () => {
    const text = depositLinkText({
      restaurantName: 'Café A', amount: HK400, payBy: '19:05', paymentUrl: 'https://app.example/p/tok',
      booking: { date: '2026-12-24', time: '19:00', partySize: 4 },
      terms: { zh_hk: '訂金每位 HK$100。', en: 'Deposit HK$100 per guest.' },
    })
    expect(text).toBe(
      [
        '請於 19:05 前付訂金 HK$400，付款後你 2026-12-24 19:00（4 位）的訂座要求才會送出：',
        'Please pay the HK$400 deposit by 19:05 to send your booking request for 4 on 2026-12-24 at 19:00:',
        'https://app.example/p/tok',
        '',
        '訂金每位 HK$100。',
        'Deposit HK$100 per guest.',
        '訂金由 Stripe 代Café A處理，Stripe 或會在香港以外地方處理你的付款資料。',
        'The deposit is processed by Stripe for Café A; Stripe may process your payment details outside Hong Kong.',
      ].join('\n')
    )
  })

  it('R64: payment unavailable is one fixed text', () => {
    expect(PAYMENT_UNAVAILABLE_TEXT).toBe(
      '暫時未能處理訂金付款，所以未有為你訂座，請直接聯絡餐廳。\nPayment is unavailable right now, so no booking was made. Please message the restaurant.'
    )
  })

  it('Q5: the restaurant decides, quoting the rule when set', () => {
    expect(depositDecisionText(HK400, { zh_hk: null, en: null })).toBe('你已付的訂金 HK$400 會由餐廳決定是否退回。\nThe restaurant will decide on your HK$400 deposit.')
  })
})
