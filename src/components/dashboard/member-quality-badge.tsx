'use client'

import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import {
  CONTACT_QUALITY_WINDOW_DAYS,
  UNKNOWN_CONTACT_QUALITY,
  type ContactQuality,
} from '@/domain/value-objects/contact-quality'
import { buildQualityTooltip } from './member-detail-helpers'

// Tones mirror RatingBadge in src/app/admin/(dashboard)/quality/page.tsx.
const TONE_CLASS: Record<ContactQuality['rating'], string> = {
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

interface MemberQualityBadgeProps {
  memberId: string
  quality?: ContactQuality
  testId?: string
}

export function MemberQualityBadge({ memberId, quality, testId }: MemberQualityBadgeProps) {
  const t = useTranslations('members')
  const q = quality ?? UNKNOWN_CONTACT_QUALITY
  const tip = buildQualityTooltip(q, CONTACT_QUALITY_WINDOW_DAYS)
  const title = t(tip.key, tip.values)

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
