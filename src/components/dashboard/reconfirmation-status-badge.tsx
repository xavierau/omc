'use client'

import { useTranslations } from 'next-intl'

interface Props {
  mode: 'marketing' | 'reconfirmation'
}

export function ReconfirmationStatusBadge({ mode }: Props) {
  const t = useTranslations('reconfirmation')
  if (mode !== 'reconfirmation') return null
  return (
    <span
      data-mode="reconfirmation"
      className="inline-flex items-center rounded-md border border-orange-300 bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-900"
    >
      {t('campaignCardLabel')}
    </span>
  )
}
