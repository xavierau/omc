'use client'

// WAQ-011-DETAIL: the read-only half of the review panel — Summary,
// Template preview, Campaigns. Fetches the detail when the panel opens; the
// summary renders at once from the list row and fills in template facts.

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { TemplateReviewItem } from '@/hooks/use-admin-template-reviews'
import {
  useAdminTemplateReviewDetail,
  type TemplateReviewDetail,
} from '@/hooks/use-admin-template-review-detail'
import { TemplateReviewPreview } from './template-review-preview'
import { TemplateReviewCampaigns } from './template-review-campaigns'

type T = ReturnType<typeof useTranslations>

export function TemplateReviewDetailSections({ review }: { review: TemplateReviewItem }) {
  const t = useTranslations('adminTemplateReviews')
  const { detail, isLoading, error, refetch } = useAdminTemplateReviewDetail(review.id)
  return (
    <>
      <Section title={t('sectionSummary')}>
        <ReviewSummary review={review} detail={detail} t={t} />
      </Section>
      {error ? (
        <div data-testid="template-review-detail-error" role="alert" className="space-y-2">
          <p className="text-destructive">{t('detailError')}</p>
          <Button variant="outline" size="sm" onClick={refetch}>{t('detailRetry')}</Button>
        </div>
      ) : isLoading || !detail ? (
        <p data-testid="template-review-detail-loading" aria-live="polite" className="text-muted-foreground">
          {t('detailLoading')}
        </p>
      ) : (
        <LoadedSections review={review} detail={detail} t={t} />
      )}
    </>
  )
}

function LoadedSections({ review, detail, t }: {
  review: TemplateReviewItem
  detail: TemplateReviewDetail
  t: T
}) {
  return (
    <>
      <Section title={t('sectionPreview')}>
        {detail.template ? (
          <TemplateReviewPreview components={detail.template.components} />
        ) : (
          <div className="space-y-1">
            <p className="text-muted-foreground">{t('templateMissing')}</p>
            {review.contentPreview && <p className="whitespace-pre-wrap">{review.contentPreview}</p>}
          </div>
        )}
      </Section>
      <Section title={t('sectionCampaigns')}>
        <TemplateReviewCampaigns campaigns={detail.campaigns} />
      </Section>
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  )
}

function ReviewSummary({ review, detail, t }: {
  review: TemplateReviewItem
  detail: TemplateReviewDetail | null
  t: T
}) {
  const restaurantName = review.restaurantName ?? detail?.restaurant.name ?? null
  const email = review.submitterEmail ?? detail?.submitterEmail ?? null
  const tpl = detail?.template ?? null
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <dt className="text-muted-foreground">{t('panelTenant')}</dt>
      <dd title={t('restaurantIdTooltip', { id: review.restaurantId })}>
        {restaurantName ?? review.restaurantId}
      </dd>
      <dt className="text-muted-foreground">{t('panelTemplate')}</dt><dd>{review.templateName}</dd>
      <dt className="text-muted-foreground">{t('panelLanguage')}</dt><dd>{tpl?.language ?? '—'}</dd>
      <dt className="text-muted-foreground">{t('panelCategory')}</dt><dd>{tpl?.category ?? '—'}</dd>
      <dt className="text-muted-foreground">{t('panelMetaStatus')}</dt><dd>{tpl?.status ?? '—'}</dd>
      <dt className="text-muted-foreground">{t('panelSubmitted')}</dt>
      <dd>{new Date(review.submittedAt).toLocaleString('en-HK')}</dd>
      <dt className="text-muted-foreground">{t('panelSubmittedBy')}</dt>
      <dd className="break-all">{email ?? t('panelSubmitterUnknown')}</dd>
    </dl>
  )
}
