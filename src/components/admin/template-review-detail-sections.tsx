'use client'

// WAQ-011-DETAIL: the read-only half of the review panel — Summary,
// Submitted content, Current template, Campaigns. The detail state comes from
// the sheet (it also gates the decision buttons). Summary and Submitted
// content render at once from the list row, in every state: the admin judges
// the submission, and the current template is shown only as context.

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { TemplateReviewItem } from '@/hooks/use-admin-template-reviews'
import type {
  TemplateReviewDetail,
  TemplateReviewDetailState,
} from '@/hooks/use-admin-template-review-detail'
import { TemplateReviewPreview } from './template-review-preview'
import { TemplateReviewCampaigns } from './template-review-campaigns'

type T = ReturnType<typeof useTranslations>

export function TemplateReviewDetailSections({ review, state }: {
  review: TemplateReviewItem
  state: TemplateReviewDetailState
}) {
  const t = useTranslations('adminTemplateReviews')
  const { detail, isLoading, error, refetch } = state
  return (
    <>
      <Section title={t('sectionSummary')}>
        <ReviewSummary review={review} detail={detail} t={t} />
      </Section>
      <Section title={t('sectionSubmittedContent')}>
        <SubmittedContent text={review.contentPreview} t={t} />
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
        <LoadedSections detail={detail} t={t} />
      )}
    </>
  )
}

function SubmittedContent({ text, t }: { text: string | null; t: T }) {
  return (
    <div data-testid="template-review-submitted-content" className="rounded-md border p-3">
      {text ? (
        <p className="whitespace-pre-wrap break-words leading-relaxed">{text}</p>
      ) : (
        <p className="text-muted-foreground">{t('submittedContentEmpty')}</p>
      )}
    </div>
  )
}

function LoadedSections({ detail, t }: { detail: TemplateReviewDetail; t: T }) {
  return (
    <>
      <Section title={t('sectionCurrentTemplate')}>
        {detail.template && !detail.templateMissing ? (
          <TemplateReviewPreview components={detail.template.components} />
        ) : (
          <p data-testid="template-review-template-missing" role="status" className="text-muted-foreground">
            {t('templateMissing')}
          </p>
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
      <dt className="text-muted-foreground">{t('panelSubmittedAudience')}</dt>
      <dd>{review.targetAudienceSize === null ? '—' : review.targetAudienceSize.toLocaleString('en-HK')}</dd>
      <dt className="text-muted-foreground">{t('panelSubmitted')}</dt>
      <dd>{new Date(review.submittedAt).toLocaleString('en-HK')}</dd>
      <dt className="text-muted-foreground">{t('panelSubmittedBy')}</dt>
      <dd className="break-all">{email ?? t('panelSubmitterUnknown')}</dd>
    </dl>
  )
}
