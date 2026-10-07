'use client'

import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { CONTACT_QUALITY_WINDOW_DAYS } from '@/domain/value-objects/contact-quality'
import type { MemberQuality } from '@/hooks/use-members'

// Tones mirror RatingBadge in src/app/admin/(dashboard)/quality/page.tsx.
const TONE_CLASS: Record<MemberQuality['rating'], string> = {
  green: 'bg-green-500/15 text-green-700 dark:text-green-300',
  yellow: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300',
  red: 'bg-red-500/15 text-red-700 dark:text-red-300',
  unknown: 'bg-muted text-muted-foreground',
}

const LABEL_KEY = {
  green: 'qualityGreen',
  yellow: 'qualityYellow',
  red: 'qualityRed',
  unknown: 'qualityNoData',
} as const

const NO_DATA: MemberQuality = { rating: 'unknown', deliveryRate: null, sampleSize: 0 }

interface MemberQualityBadgeProps {
  memberId: string
  quality?: MemberQuality
  testId?: string
}

export function MemberQualityBadge({ memberId, quality, testId }: MemberQualityBadgeProps) {
  const t = useTranslations('members')
  const q = quality ?? NO_DATA
  const days = CONTACT_QUALITY_WINDOW_DAYS
  const title =
    q.sampleSize === 0 || q.deliveryRate === null
      ? t('qualityNoDataTooltip', { days })
      : t('qualityTooltip', { rate: Math.round(q.deliveryRate * 100), count: q.sampleSize, days })

  return (
    <Badge
      variant="outline"
      className={TONE_CLASS[q.rating]}
      title={title}
      data-testid={testId ?? `members-row-${memberId}-quality`}
    >
      {t(LABEL_KEY[q.rating])}
    </Badge>
  )
}
