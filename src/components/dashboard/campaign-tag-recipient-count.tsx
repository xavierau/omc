'use client'

import { useTranslations } from 'next-intl'
import { useTagRecipientCount } from '@/hooks/use-tag-recipient-count'

interface CampaignTagRecipientCountProps {
  tagIds: string[]
}

/**
 * Live recipient count under the campaign tag picker (#138b, Feedback
 * State 6). Never blocks submit — a zero count or a failed request are
 * both rendered as inline advisory lines, not errors that gate the form.
 */
export function CampaignTagRecipientCount({ tagIds }: CampaignTagRecipientCountProps) {
  const t = useTranslations('campaigns')
  const { count, isLoading, error } = useTagRecipientCount(tagIds)

  if (isLoading) {
    return (
      <p
        data-field="recipient-count"
        data-state="loading"
        className="text-sm text-muted-foreground"
      >
        {t('recipientCountLoading')}
      </p>
    )
  }

  if (error) {
    return (
      <p data-field="recipient-count" data-state="error" className="text-sm text-destructive">
        {t('recipientCountError')}
      </p>
    )
  }

  if (count === null) return null

  if (count === 0) {
    return (
      <p data-field="recipient-count" data-state="zero" className="text-sm text-amber-600">
        {t('recipientCountZero')}
      </p>
    )
  }

  return (
    <p data-field="recipient-count" data-state="ok" className="text-sm text-muted-foreground">
      {t('recipientCount', { count })}
    </p>
  )
}
