'use client'

/**
 * BOOK-014 W3 (spec AC-5, UI Feedback States): the /b page's deposit pieces.
 * - DepositLine: "Deposit HK$X" above the submit, only when the chosen party
 *   owes one (the same depositFor the server charges with, R53).
 * - depositSubmitLabel: "Pay deposit HK$X and send" for the submit button.
 * - DepositTerms (W6a, AC-3): the restaurant's deposit terms (amount rule and
 *   refund note, depositTermsText), zh-HK then en, while a deposit applies.
 * - DepositRedirect: the hold is made; the browser goes to our /p link,
 *   which sends the diner on to the provider's hosted page.
 * - DepositUnavailable: the provider failed at submit (503); no booking was
 *   kept and the link is spent, so the diner is sent to WhatsApp.
 */
import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { CreditCard } from 'lucide-react'
import { depositForPlan, type DepositPlan } from '@/domain/value-objects/deposit-plan'
import { formatMoney } from '@/domain/value-objects/money'

type Translate = (key: string, vars?: Record<string, string>) => string

/** The submit label when a deposit is owed, else null (the caller keeps its own label). */
export function depositSubmitLabel(t: Translate, plan: DepositPlan | null | undefined, partySize: number | null): string | null {
  const owed = depositForPlan(plan, partySize)
  return owed ? t('deposit.submit', { amount: formatMoney(owed) }) : null
}

export function DepositLine({ plan, partySize }: { plan: DepositPlan | null | undefined; partySize: number | null }) {
  const t = useTranslations('booking')
  const owed = depositForPlan(plan, partySize)
  if (!owed) return null
  return (
    <p data-testid="booking-deposit-line" className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm text-foreground">
      <CreditCard className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span>{t('deposit.line', { amount: formatMoney(owed) })}</span>
    </p>
  )
}

export function DepositTerms({ plan }: { plan: DepositPlan | null | undefined }) {
  const lines = plan?.terms ? ([['zh-HK', plan.terms.zh_hk], ['en', plan.terms.en]] as const).filter(([, text]) => text) : []
  if (lines.length === 0) return null
  return (
    <section data-testid="booking-deposit-terms" className="space-y-1.5 text-sm leading-relaxed text-foreground">
      {lines.map(([lang, text]) => (
        <p key={lang} lang={lang} className="whitespace-pre-line">
          {text}
        </p>
      ))}
    </section>
  )
}

export function DepositRedirect({ url }: { url: string }) {
  const t = useTranslations('booking')
  useEffect(() => {
    window.location.assign(url)
  }, [url])
  return (
    <div data-testid="booking-deposit-redirect" role="status" className="space-y-3 text-center">
      <p className="text-sm text-muted-foreground">{t('deposit.redirecting')}</p>
      <a href={url} className="text-sm font-medium text-primary underline underline-offset-2">
        {t('deposit.continue')}
      </a>
    </div>
  )
}

export function DepositUnavailable({ retryUrl }: { retryUrl: string | null }) {
  const t = useTranslations('booking')
  return (
    <div className="space-y-4 text-center">
      <p data-testid="booking-deposit-error" role="alert" className="text-sm font-medium text-destructive">
        {t('deposit.unavailable')}
      </p>
      {retryUrl ? (
        <a
          data-testid="booking-ask-whatsapp"
          href={retryUrl}
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t('askOnWhatsapp')}
        </a>
      ) : null}
    </div>
  )
}
