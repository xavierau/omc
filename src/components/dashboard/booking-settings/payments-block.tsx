'use client'

/**
 * BOOK-014 W2 (spec S1 AC-1, AC-2): Payments. The account status chip
 * (Connecting · Active · Action needed + Stripe's reason), and for admins
 * "Connect Stripe" / "Continue setup". Status comes from the server only.
 */
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { connectAction, reasonKey, type PaymentAccountHook, type PaymentChip } from '@/hooks/use-payment-account'
import { SettingsBlock } from './block'

const CHIP_VARIANT: Record<PaymentChip, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  none: 'outline', connecting: 'secondary', active: 'default', action_needed: 'destructive', disconnected: 'destructive',
}

function Reason({ reason }: { reason: string | null }) {
  const t = useTranslations('bookingSettings.payments.reason')
  const key = reasonKey(reason)
  return key ? <p data-testid="booking-settings-payment-reason" className="text-xs text-muted-foreground">{t(key, { reason: reason ?? '' })}</p> : null
}

export function PaymentsBlock({ payments }: { payments: PaymentAccountHook }) {
  const t = useTranslations('bookingSettings.payments')
  const action = connectAction(payments.chip)
  return (
    <SettingsBlock title={t('title')} hint={t('hint')} testId="booking-settings-payments">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={CHIP_VARIANT[payments.chip]} data-testid="booking-settings-payment-status" aria-live="polite">
          {payments.loading ? t('loading') : t(`status.${payments.chip}`)}
        </Badge>
        {payments.canManage && action && !payments.loading ? (
          <Button onClick={payments.connect} disabled={payments.connecting} data-testid="booking-settings-payment-connect">
            {payments.connecting ? t('opening') : t(action)}
          </Button>
        ) : null}
      </div>
      <Reason reason={payments.account?.restrictionReason ?? null} />
      {!payments.canManage && !payments.loading ? <p className="text-xs text-muted-foreground">{t('adminOnly')}</p> : null}
      {payments.loadFailed ? <p role="alert" data-testid="booking-settings-payment-error" className="text-xs text-destructive">{t('loadFailed')}</p> : null}
      {payments.connectError ? <p role="alert" data-testid="booking-settings-payment-error" className="text-xs text-destructive">{t('connectFailed')}</p> : null}
    </SettingsBlock>
  )
}
