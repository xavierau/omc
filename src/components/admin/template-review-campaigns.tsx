'use client'

// WAQ-011-DETAIL: every campaign that sends the reviewed template — who it
// reaches, what coupon it carries, when it goes out.

import { useFormatter, useTranslations } from 'next-intl'
import type { TemplateReviewDetailCampaign } from '@/hooks/use-admin-template-review-detail'

type T = ReturnType<typeof useTranslations>
type Format = ReturnType<typeof useFormatter>

// Campaign times are restaurant-local (HK); the provider sets no global timeZone.
const SCHEDULE_FORMAT = { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Hong_Kong' } as const

export function TemplateReviewCampaigns({ campaigns }: { campaigns: TemplateReviewDetailCampaign[] }) {
  const t = useTranslations('adminTemplateReviews')
  const format = useFormatter()
  if (campaigns.length === 0) {
    return (
      <p data-testid="template-review-campaigns-empty" className="text-muted-foreground">
        {t('noCampaigns')}
      </p>
    )
  }
  return (
    <ul className="space-y-2">
      {campaigns.map((c) => <CampaignCard key={c.id} campaign={c} t={t} format={format} />)}
    </ul>
  )
}

function CampaignCard({ campaign: c, t, format }: {
  campaign: TemplateReviewDetailCampaign
  t: T
  format: Format
}) {
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
        <dd>{scheduleLabel(c, t, format)}</dd>
      </dl>
    </li>
  )
}

// 'selected' is a count of picked campaign_members rows, not active reach.
function audienceLabel(c: TemplateReviewDetailCampaign, t: T): string {
  const label = t(`audience.${c.targetAudience}`)
  if (c.audienceSize === null) return t('campaignAudienceUnknown', { label })
  if (c.targetAudience === 'selected') return t('campaignAudienceSelected', { count: c.audienceSize })
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

// Finished campaigns report their outcome; draft and paused ones send nothing
// until resumed, so they show their status — never "Scheduled". For active /
// sending: a `schedule` JSON means trigger/recurring sends (welcome, birthday,
// winback); otherwise one-off or manual.
function scheduleLabel(c: TemplateReviewDetailCampaign, t: T, format: Format): string {
  if (c.status === 'completed') return t('campaignScheduleSent')
  if (c.status === 'failed') return t('campaignScheduleFailed')
  if (c.status === 'draft' || c.status === 'paused') return t(`campaignStatus.${c.status}`)
  if (c.schedule) return t('campaignAutomatic')
  if (c.scheduledAt) {
    return t('campaignScheduled', { date: format.dateTime(new Date(c.scheduledAt), SCHEDULE_FORMAT) })
  }
  return t('campaignManualSend')
}
