'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import {
  submitTemplateReviewDecision,
  runTemplateReviewDecision,
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
// read-only summary to ReviewSummary / DecisionOutcomeSummary. Not unit-tested
// directly (useState makes it opaque to the shallow renderTree helper); its
// pending-vs-decided branch is a plain `review.status === 'pending'` read (no
// independent logic to test), and the failure-refetch behavior is covered via
// runTemplateReviewDecision in template-review-decision.test.ts.
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
    const outcome = await runTemplateReviewDecision({
      reviewId: review.id,
      action,
      notes,
      fallback: t('decisionError'),
      submit: submitTemplateReviewDecision,
      onDecided,
    })
    setSubmittingAction(null)
    if (!outcome.ok) { setError(outcome.error); return }
    onOpenChange(false)
  }

  const isPending = review.status === 'pending'

  return (
    <Sheet open={Boolean(review)} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('panelTitle')}</SheetTitle>
          <SheetDescription>{t('panelDescription')}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4 space-y-4 text-sm">
          <ReviewSummary review={review} t={t} />
          {isPending ? (
            <>
              <NotesField notes={notes} onChange={setNotes} t={t} />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DecisionButtons
                submittingAction={submittingAction}
                onDecide={handleDecide}
                t={t}
              />
            </>
          ) : (
            <DecisionOutcomeSummary review={review} t={t} />
          )}
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

const NOTES_MAX_LEN = 2000

function NotesField({ notes, onChange, t }: { notes: string; onChange: (v: string) => void; t: T }) {
  return (
    <div>
      <label htmlFor="template-review-notes" className="text-sm font-medium text-foreground block mb-1">
        {t('notesLabel')}
      </label>
      <textarea
        id="template-review-notes"
        value={notes}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('notesPlaceholder')}
        rows={3}
        maxLength={NOTES_MAX_LEN}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </div>
  )
}

// Renders in place of NotesField + DecisionButtons once a decision exists —
// review.status !== 'pending' means a second decision would 500 (the domain
// entity only transitions out of 'pending' once), so no action UI is offered.
function DecisionOutcomeSummary({ review, t }: { review: TemplateReviewItem; t: T }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <dt className="text-muted-foreground">{t('panelReviewedBy')}</dt>
      <dd>{review.reviewedBy ?? '—'}</dd>
      <dt className="text-muted-foreground">{t('panelReviewedAt')}</dt>
      <dd>{review.reviewedAt ? new Date(review.reviewedAt).toLocaleString('en-HK') : '—'}</dd>
      <dt className="text-muted-foreground">{t('panelReviewNotes')}</dt>
      <dd className="whitespace-pre-wrap">{review.reviewNotes || t('panelNoNotes')}</dd>
    </dl>
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
