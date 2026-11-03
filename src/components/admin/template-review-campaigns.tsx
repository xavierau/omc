'use client'

// WAQ-011-DETAIL: every campaign that sends the reviewed template — who it
// reaches, what coupon it carries, when it goes out.

import { useTranslations } from 'next-intl'
import type { TemplateReviewDetailCampaign } from '@/hooks/use-admin-template-review-detail'

type T = ReturnType<typeof useTranslations>

export function TemplateReviewCampaigns({ campaigns }: { campaigns: TemplateReviewDetailCampaign[] }) {
  const t = useTranslations('adminTemplateReviews')
  if (campaigns.length === 0) {
    return (
      <p data-testid="template-review-campaigns-empty" className="text-muted-foreground">
        {t('noCampaigns')}
      </p>
    )
  }
  return (
    <ul className="space-y-2">
      {campaigns.map((c) => <CampaignCard key={c.id} campaign={c} t={t} />)}
    </ul>
  )
}

function CampaignCard({ campaign: c, t }: { campaign: TemplateReviewDetailCampaign; t: T }) {
  return (
    <li data-testid={`template-review-campaign-${c.id}`} className="rounded-md border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-medium break-words">{c.name || t('campaignUnnamed')}</p>
        <p className="text-xs text-muted-foreground">
          {t(`campaignType.${c.type}`)} · {t(`campaignStatus.${c.status}`)}
        </p>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">{t('campaignAudience')}</dt>
        <dd>{audienceLabel(c, t)}</dd>
        <dt className="text-muted-foreground">{t('campaignCoupon')}</dt>
        <dd>{couponLabel(c, t)}</dd>
        <dt className="text-muted-foreground">{t('campaignSchedule')}</dt>
        <dd>{scheduleLabel(c, t)}</dd>
      </dl>
    </li>
  )
}

function audienceLabel(c: TemplateReviewDetailCampaign, t: T): string {
  const label = t(`audience.${c.targetAudience}`)
  if (c.audienceSize === null) return t('campaignAudienceUnknown', { label })
  return t('campaignAudienceSize', { label, count: c.audienceSize })
}

function couponLabel(c: TemplateReviewDetailCampaign, t: T): string {
  const coupon = c.couponConfig
  if (!coupon) return t('campaignNoCoupon')
  const values = { value: coupon.discountValue, days: coupon.expiresInDays }
  return coupon.discountType === 'percentage'
    ? t('campaignCouponPercent', values)
    : t('campaignCouponFixed', values)
}

function scheduleLabel(c: TemplateReviewDetailCampaign, t: T): string {
  if (!c.scheduledAt) return t('campaignSendNow')
  return t('campaignScheduled', { date: new Date(c.scheduledAt).toLocaleString('en-HK') })
}
