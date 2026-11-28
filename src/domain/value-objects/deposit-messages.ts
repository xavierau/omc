/**
 * BOOK-014 W5 (spec AC-9, AC-10, Q5; threat R61, R64): the fixed WhatsApp
 * texts of the two agent channels, both languages, zh-HK first (as every
 * in-window booking text). The amount, the hold end and the link are built
 * on the server; nothing here comes from a model or a request (R59).
 *
 * - `depositProcessingSentence`: who processes the deposit and that it may
 *   leave Hong Kong (R61, PDPO DPP1). Same wording as the booking page's
 *   collection statement (W3, collection-statement.tsx).
 * - `depositLinkText`: the payment link message (AI agent create, PAP code step).
 * - `PAYMENT_UNAVAILABLE_TEXT`: the provider was down; no booking was kept (R64).
 * - `depositDecisionText`: a diner cancelled a booking with a paid deposit (Q5).
 */
import { formatMoney, type Money } from './money'

export interface DepositTexts {
  zh_hk: string
  en: string
}

/** R61: the restaurant name must already be flattened (sanitizeTemplateParam) by the caller. */
export function depositProcessingSentence(restaurantName: string): DepositTexts {
  return {
    zh_hk: `訂金由 Stripe 代${restaurantName}處理，Stripe 或會在香港以外地方處理你的付款資料。`,
    en: `The deposit is processed by Stripe for ${restaurantName}; Stripe may process your payment details outside Hong Kong.`,
  }
}

export interface DepositLinkInput {
  restaurantName: string
  amount: Money
  /** HH:MM in Hong Kong: the end of the 30-minute hold. */
  payBy: string
  /** Our /p/<token> link (built server side, R62). */
  paymentUrl: string
  booking: { date: string; time: string; partySize: number }
  /** depositTermsText per language (amount rule + the admin's refund note); null = none. */
  terms: { zh_hk: string | null; en: string | null }
}

/** The payment link message: what to pay, by when, the link, the refund rule, then R61. */
export function depositLinkText(input: DepositLinkInput): string {
  const amount = formatMoney(input.amount)
  const { date, time, partySize } = input.booking
  const processing = depositProcessingSentence(input.restaurantName)
  return [
    `請於 ${input.payBy} 前付訂金 ${amount}，付款後你 ${date} ${time}（${partySize} 位）的訂座要求才會送出：`,
    `Please pay the ${amount} deposit by ${input.payBy} to send your booking request for ${partySize} on ${date} at ${time}:`,
    input.paymentUrl,
    '',
    ...(input.terms.zh_hk ? [input.terms.zh_hk] : []),
    ...(input.terms.en ? [input.terms.en] : []),
    processing.zh_hk,
    processing.en,
  ].join('\n')
}

/** R64: a fixed text; the provider's error never reaches the diner. */
export const PAYMENT_UNAVAILABLE_TEXT =
  '暫時未能處理訂金付款，所以未有為你訂座，請直接聯絡餐廳。\nPayment is unavailable right now, so no booking was made. Please message the restaurant.'

/** Q5: the restaurant decides what happens to a paid deposit; the admin's rule is quoted when set. */
export function depositDecisionText(amount: Money, terms: { zh_hk: string | null; en: string | null }): string {
  const value = formatMoney(amount)
  return [
    `你已付的訂金 ${value} 會由餐廳決定是否退回。`,
    ...(terms.zh_hk ? [terms.zh_hk] : []),
    `The restaurant will decide on your ${value} deposit.`,
    ...(terms.en ? [terms.en] : []),
  ].join('\n')
}
