'use client'

/**
 * BOOK-014 W2 (spec S2 AC-3): the deposit line diners and agents will read,
 * in both languages, from the shared domain renderer (depositTermsText); and
 * the block's save errors (field errors, or the 409 "Connect Stripe first").
 */
import { useTranslations } from 'next-intl'
import { depositTermsText } from '@/domain/value-objects/deposit-terms'
import { DEPOSIT_MAX_WHOLE, DEPOSIT_MIN_WHOLE } from '@/domain/value-objects/deposit-rule'
import { depositRuleOf, type DepositForm } from '@/hooks/use-booking-settings'

const LANGS = ['zh_hk', 'en'] as const

export function DepositSummary({ deposit, currency }: { deposit: DepositForm; currency: string }) {
  const t = useTranslations('bookingSettings.deposit')
  const rule = depositRuleOf(deposit)
  return (
    <div data-testid="booking-settings-deposit-summary" className="space-y-1 rounded-lg border border-border px-3 py-2">
      <p className="text-xs font-medium text-muted-foreground">{t('summaryTitle')}</p>
      {rule ? (
        LANGS.map((lang) => (
          <p key={lang} lang={lang === 'zh_hk' ? 'zh-HK' : 'en'} className="text-sm text-foreground">{depositTermsText(rule, currency, lang)}</p>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">{t('summaryNone')}</p>
      )}
    </div>
  )
}

const FIELDS = ['enabled', 'mode', 'amount', 'fromPartySize', 'refundNote'] as const

export function DepositErrors({ errors, blocked }: { errors: Record<string, string>; blocked: boolean }) {
  const t = useTranslations('bookingSettings.deposit.errors')
  const failed = FIELDS.filter((f) => errors[`deposit.${f}`])
  if (!blocked && failed.length === 0) return null
  return (
    <div role="alert" data-testid="booking-settings-deposit-error" className="space-y-0.5 text-xs text-destructive">
      {blocked ? <p>{t('blocked')}</p> : null}
      {failed.map((f) => <p key={f}>{t(f, { min: DEPOSIT_MIN_WHOLE, max: DEPOSIT_MAX_WHOLE })}</p>)}
    </div>
  )
}
