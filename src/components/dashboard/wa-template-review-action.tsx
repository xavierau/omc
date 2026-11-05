'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { extractTemplateBodyText, submitTemplateForReview } from './template-review-submit'
import type { WaTemplate } from '@/hooks/use-wa-templates'

type SubmitState = 'idle' | 'submitting' | 'submitted' | 'already_submitted' | 'error'

interface Props {
  template: WaTemplate
}

export function WaTemplateReviewAction({ template }: Props) {
  const t = useTranslations('templateReview')
  const [state, setState] = useState<SubmitState>('idle')

  const handleSubmit = async () => {
    setState('submitting')
    const outcome = await submitTemplateForReview({
      templateName: template.name,
      templateId: template.id,
      contentPreview: extractTemplateBodyText(template.components),
    })
    setState(outcome.status)
  }

  if (state === 'submitted' || state === 'already_submitted') {
    return (
      <span className="text-xs text-muted-foreground">
        {state === 'submitted' ? t('submitted') : t('alreadySubmitted')}
      </span>
    )
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      <button
        onClick={handleSubmit}
        disabled={state === 'submitting'}
        className="text-sm text-primary hover:underline disabled:opacity-50"
      >
        {state === 'submitting' ? t('submitting') : t('submitAction')}
      </button>
      {state === 'error' && <p className="text-xs text-destructive">{t('submitFailed')}</p>}
    </div>
  )
}
