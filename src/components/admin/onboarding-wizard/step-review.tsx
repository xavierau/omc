'use client'

import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import type { WizardData } from './types'

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value || '-'}</span>
    </div>
  )
}

export function StepReview({ data }: { data: WizardData }) {
  const t = useTranslations('onboarding')
  const ta = useTranslations('admin')

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('reviewTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('reviewDescription')}</p>
      </div>
      <Card>
        <CardContent className="divide-y">
          <ReviewRow label={ta('restaurantName')} value={data.name} />
          <ReviewRow label={ta('slugField')} value={data.slug} />
          <ReviewRow label={ta('adminEmail')} value={data.adminEmail} />
          <ReviewRow label={ta('whatsappNumber')} value={data.whatsappNumber} />
          <ReviewRow label={ta('kapsoPhoneNumberId')} value={data.kapsoPhoneNumberId} />
          <ReviewRow label={ta('metaBusinessAccountId')} value={data.metaBusinessAccountId} />
        </CardContent>
      </Card>
    </div>
  )
}
