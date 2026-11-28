/**
 * BOOK-014 (spec S2, AC-3): the ONE deposit line diners and agents read, from
 * the restaurant's rule and its account currency, followed by the refund note
 * the admin wrote for that language. The settings summary (W2), the booking
 * page terms (W3) and the agent / PAP text (W5) all call this, so every
 * channel states the same amount and the same rule.
 *
 * '訂金每位 HK$100（6位或以上）。<note>' / 'Deposit HK$100 per guest for 6 or more. <note>'
 */
import type { LanguageCode } from './language'
import { DEPOSIT_RULE_OFF, validateDepositRule, type DepositRule } from './deposit-rule'
import { formatMoney, fromWholeUnits, isCurrencyCode } from './money'

function amountLine(rule: DepositRule, amount: string, language: LanguageCode): string {
  const from = rule.fromPartySize
  if (language === 'zh_hk') {
    const head = rule.mode === 'per_guest' ? `訂金每位 ${amount}` : `訂金每張訂座 ${amount}`
    return from > 1 ? `${head}（${from}位或以上）` : head
  }
  if (rule.mode === 'per_guest') return from > 1 ? `Deposit ${amount} per guest for ${from} or more` : `Deposit ${amount} per guest`
  return from > 1 ? `Deposit ${amount} per booking for ${from} or more guests` : `Deposit ${amount} per booking`
}

/** The deposit line plus the refund note, or null when no deposit applies (rule off or not valid). */
export function depositTermsText(rule: DepositRule, currency: string, language: LanguageCode): string | null {
  const parsed = validateDepositRule(rule)
  const valid = parsed.ok ? parsed.rule : DEPOSIT_RULE_OFF
  const code = currency.toUpperCase()
  if (!valid.enabled || !isCurrencyCode(code)) return null
  const line = amountLine(valid, formatMoney(fromWholeUnits(valid.amount, code)), language)
  const note = valid.refundNote[language]
  if (!note) return line
  return language === 'zh_hk' ? `${line}。${note}` : `${line}. ${note}`
}
