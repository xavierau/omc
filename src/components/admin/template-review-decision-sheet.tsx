'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import {
  submitTemplateReviewDecision,
  decisionNeedsNotes,
  type ReviewDecisionAction,
} from './template-review-decision'
import type { TemplateReviewItem } from '@/hooks/use-admin-template-reviews'

interface Props {
  review: TemplateReviewItem | null
  onOpenChange: (open: boolean) => void
  onDecided: () => void
}

// Stateful container — owns the notes field + in-flight action, delegating the
// read-only summary to ReviewSummary. Not unit-tested directly (useState makes
// it opaque to the shallow renderTree helper); its fetch logic is covered by
// template-review-decision.test.ts.
export function TemplateReviewDecisionSheet({ review, onOpenChange, onDecided }: Props) {
  const t = useTranslations('adminTemplateReviews')
  const [notes, setNotes] = useState('')
  const [submittingAction, setSubmittingAction] = useState<ReviewDecisionAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setNotes('')
    setError(null)
    setSubmittingAction(null)
  }, [review?.id])

  if (!review) return null

  const handleDecide = async (action: ReviewDecisionAction) => {
    if (decisionNeedsNotes(action) && !notes.trim()) {
      setError(t('notesRequired'))
      return
    }
    setSubmittingAction(action)
    setError(null)
    const outcome = await submitTemplateReviewDecision(review.id, action, notes, t('decisionError'))
    setSubmittingAction(null)
    if (!outcome.ok) { setError(outcome.error); return }
    onDecided()
    onOpenChange(false)
  }

  return (
    <Sheet open={Boolean(review)} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('panelTitle')}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4 space-y-4 text-sm">
          <ReviewSummary review={review} t={t} />
          <NotesField notes={notes} onChange={setNotes} t={t} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DecisionButtons
            submittingAction={submittingAction}
            onDecide={handleDecide}
            t={t}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}

type T = (key: string) => string

function ReviewSummary({ review, t }: { review: TemplateReviewItem; t: T }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <dt className="text-muted-foreground">{t('panelTenant')}</dt><dd>{review.restaurantId}</dd>
      <dt className="text-muted-foreground">{t('panelTemplate')}</dt><dd>{review.templateName}</dd>
      <dt className="text-muted-foreground">{t('panelAudience')}</dt>
      <dd>{review.targetAudienceSize ?? '—'}</dd>
      <dt className="text-muted-foreground">{t('panelSubmitted')}</dt>
      <dd>{new Date(review.submittedAt).toLocaleString('en-HK')}</dd>
      <dt className="text-muted-foreground">{t('panelSubmittedBy')}</dt><dd>{review.submittedBy}</dd>
      {review.contentPreview && (
        <>
          <dt className="text-muted-foreground">{t('panelContent')}</dt>
          <dd className="whitespace-pre-wrap">{review.contentPreview}</dd>
        </>
      )}
    </dl>
  )
}

function NotesField({ notes, onChange, t }: { notes: string; onChange: (v: string) => void; t: T }) {
  return (
    <div>
      <label className="text-sm font-medium text-foreground block mb-1">{t('notesLabel')}</label>
      <textarea
        value={notes}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('notesPlaceholder')}
        rows={3}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </div>
  )
}

function DecisionButtons({ submittingAction, onDecide, t }: {
  submittingAction: ReviewDecisionAction | null
  onDecide: (action: ReviewDecisionAction) => void
  t: T
}) {
  const busy = Boolean(submittingAction)
  return (
    <div className="flex gap-2 flex-wrap">
      <Button onClick={() => onDecide('approve')} disabled={busy}>
        {submittingAction === 'approve' ? t('submitting') : t('approve')}
      </Button>
      <Button variant="destructive" onClick={() => onDecide('reject')} disabled={busy}>
        {submittingAction === 'reject' ? t('submitting') : t('reject')}
      </Button>
      <Button variant="outline" onClick={() => onDecide('request_changes')} disabled={busy}>
        {submittingAction === 'request_changes' ? t('submitting') : t('requestChanges')}
      </Button>
    </div>
  )
}
