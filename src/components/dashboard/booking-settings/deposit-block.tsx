'use client'

/**
 * BOOK-014 W2 (spec S2 AC-3, AC-4): 訂金 Deposit. The switch can be turned on
 * only while the payment account is active ("Connect Stripe first"); a rule
 * already on stays switchable off, with a warning that bookings are taken
 * without a deposit meanwhile. Then the amount mode, amount, from party size,
 * the refund rule per language, and the line diners and agents will read.
 */
import { useTranslations } from 'next-intl'
import { Switch } from '@/components/ui/switch'
import type { DepositForm } from '@/hooks/use-booking-settings'
import { SettingsBlock } from './block'
import { DepositFields } from './deposit-fields'
import { DepositErrors, DepositSummary } from './deposit-summary'

export interface DepositBlockProps {
  deposit: DepositForm
  onChange: (deposit: DepositForm) => void
  /** The payment account can take charges; null while its status is loading. */
  active: boolean | null
  currency: string
  errors: Record<string, string>
  blocked: boolean
}

export function DepositBlock({ deposit, onChange, active, currency, errors, blocked }: DepositBlockProps) {
  const t = useTranslations('bookingSettings.deposit')
  const locked = active !== true && !deposit.enabled
  return (
    <SettingsBlock title={t('title')} hint={t('hint')} testId="booking-settings-deposit">
      <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-foreground">
        <Switch checked={deposit.enabled} disabled={locked} onCheckedChange={(enabled) => onChange({ ...deposit, enabled })}
          data-testid="booking-settings-deposit-toggle" />
        {t('toggle')}
      </label>
      {locked ? <p data-testid="booking-settings-deposit-locked" className="text-xs text-muted-foreground">{t('connectFirst')}</p> : null}
      {active === false && deposit.enabled ? (
        <p role="status" data-testid="booking-settings-deposit-paused" className="rounded-lg bg-muted px-3 py-2 text-xs text-foreground">{t('paused')}</p>
      ) : null}
      {deposit.enabled ? <DepositFields deposit={deposit} onChange={onChange} currency={currency} errors={errors} /> : null}
      {deposit.enabled ? <DepositSummary deposit={deposit} currency={currency} /> : null}
      <DepositErrors errors={errors} blocked={blocked} />
    </SettingsBlock>
  )
}
