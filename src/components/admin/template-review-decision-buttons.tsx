'use client'

// WAQ-011 decision actions. `locked` holds them while the review detail is
// still loading (round 1, F3) so no decision is made before the panel shows
// what was submitted; an errored detail does not lock them — the submitted
// text from the list row is still on screen.

import { Button } from '@/components/ui/button'
import type { ReviewDecisionAction } from './template-review-decision'

interface Props {
  submittingAction: ReviewDecisionAction | null
  locked: boolean
  onDecide: (action: ReviewDecisionAction) => void
  t: (key: string) => string
}

export function DecisionButtons({ submittingAction, locked, onDecide, t }: Props) {
  const disabled = locked || Boolean(submittingAction)
  return (
    <div className="flex gap-2 flex-wrap">
      <Button onClick={() => onDecide('approve')} disabled={disabled}>
        {submittingAction === 'approve' ? t('submitting') : t('approve')}
      </Button>
      <Button variant="destructive" onClick={() => onDecide('reject')} disabled={disabled}>
        {submittingAction === 'reject' ? t('submitting') : t('reject')}
      </Button>
      <Button variant="outline" onClick={() => onDecide('request_changes')} disabled={disabled}>
        {submittingAction === 'request_changes' ? t('submitting') : t('requestChanges')}
      </Button>
    </div>
  )
}
