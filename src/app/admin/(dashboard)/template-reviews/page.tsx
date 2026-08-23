// WAQ-011: platform-admin template-review queue. The gate in
// checkTemplateReview/enforceTemplateReview has no other way to be satisfied
// for untrusted tenants — this page is where an admin approves/rejects a
// marketing template a tenant submitted from /dashboard/wa-templates.

'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  useAdminTemplateReviews,
  type TemplateReviewStatus,
  type TemplateReviewItem,
} from '@/hooks/use-admin-template-reviews'
import { TemplateReviewTable } from '@/components/admin/template-review-table'
import { TemplateReviewDecisionSheet } from '@/components/admin/template-review-decision-sheet'
import { Button } from '@/components/ui/button'

export default function AdminTemplateReviewsPage() {
  const t = useTranslations('adminTemplateReviews')
  const tc = useTranslations('common')
  const [status, setStatus] = useState<TemplateReviewStatus>('pending')
  const [reviewing, setReviewing] = useState<TemplateReviewItem | null>(null)
  const { reviews, isLoading, error, refetch } = useAdminTemplateReviews(status)

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh]">
        <p className="text-muted-foreground">{t('couldntLoad')}</p>
        <Button variant="outline" onClick={refetch} className="mt-4">{tc('retry')}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
        <StatusFilter status={status} onChange={setStatus} t={t} />
      </div>
      {isLoading ? (
        <p className="text-muted-foreground">{tc('loading')}</p>
      ) : (
        <TemplateReviewTable reviews={reviews} onReview={setReviewing} />
      )}
      <TemplateReviewDecisionSheet
        review={reviewing}
        onOpenChange={(open) => !open && setReviewing(null)}
        onDecided={refetch}
      />
    </div>
  )
}

function StatusFilter({ status, onChange, t }: {
  status: TemplateReviewStatus
  onChange: (s: TemplateReviewStatus) => void
  t: (key: string) => string
}) {
  return (
    <select
      value={status}
      onChange={(e) => onChange(e.target.value as TemplateReviewStatus)}
      aria-label={t('statusLabel')}
      className="h-8 rounded-md border border-input bg-background px-3 text-sm"
    >
      <option value="pending">{t('statusPending')}</option>
      <option value="approved">{t('statusApproved')}</option>
      <option value="rejected">{t('statusRejected')}</option>
      <option value="changes_requested">{t('statusChangesRequested')}</option>
    </select>
  )
}
