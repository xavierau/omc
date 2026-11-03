import { describe, it, expect, vi } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

const dateTime = vi.fn((d: Date, o: Record<string, unknown>) => `fmt(${d.toISOString()},${String(o.timeZone)})`)

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useFormatter: () => ({ dateTime }),
}))

import { TemplateReviewCampaigns } from '@/components/admin/template-review-campaigns'
import type { TemplateReviewDetailCampaign } from '@/hooks/use-admin-template-review-detail'

function flatten(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = []
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return
    out.push(child)
    if (typeof child.type === 'function') {
      const fn = child.type as (p: unknown) => ReactNode
      out.push(...flatten(fn(child.props)))
      return
    }
    const props = child.props as { children?: ReactNode }
    if (props.children !== undefined) out.push(...flatten(props.children))
  })
  return out
}

function texts(element: ReactElement): string[] {
  const fn = element.type as (p: unknown) => ReactNode
  return flatten(fn(element.props)).flatMap((el) => {
    const c = (el.props as { children?: unknown }).children
    return typeof c === 'string' ? [c] : []
  })
}

function campaign(overrides: Partial<TemplateReviewDetailCampaign> = {}): TemplateReviewDetailCampaign {
  return {
    id: 'camp-1',
    name: 'November promo',
    type: 'promo',
    status: 'draft',
    targetAudience: 'tag',
    audienceSize: 42,
    couponConfig: { discountType: 'percentage', discountValue: 20, expiresInDays: 14 },
    scheduledAt: null,
    schedule: null,
    createdAt: '2026-10-31T00:00:00Z',
    ...overrides,
  }
}

describe('TemplateReviewCampaigns', () => {
  it('shows the empty state when no campaign uses the template', () => {
    expect(texts(<TemplateReviewCampaigns campaigns={[]} />)).toContain('noCampaigns')
  })

  it('renders one card per campaign with audience size, coupon and schedule', () => {
    const tree = flatten(
      (TemplateReviewCampaigns as (p: unknown) => ReactNode)({ campaigns: [campaign()] })
    )
    const card = tree.find(
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'template-review-campaign-camp-1'
    )
    expect(card).toBeDefined()

    const all = texts(<TemplateReviewCampaigns campaigns={[campaign()]} />)
    expect(all).toContain('November promo')
    expect(all).toContain('campaignAudienceSize:{"label":"audience.tag","count":42}')
    expect(all).toContain('campaignCouponPercent:{"value":20,"days":14}')
    expect(all).toContain('campaignManualSend')
    expect(all).not.toContain('campaignSendNow')
  })

  it('says "No coupon", a fixed discount, and an unknown size where they apply', () => {
    const all = texts(
      <TemplateReviewCampaigns
        campaigns={[
          campaign({ id: 'a', couponConfig: null, targetAudience: 'all', audienceSize: null }),
          campaign({ id: 'b', couponConfig: { discountType: 'fixed_amount', discountValue: 50, expiresInDays: 7 } }),
        ]}
      />
    )
    expect(all).toContain('campaignNoCoupon')
    expect(all).toContain('campaignAudienceUnknown:{"label":"audience.all"}')
    expect(all).toContain('campaignCouponFixed:{"value":50,"days":7}')
  })

  it('labels a selected audience as a count of selected rows, not reach', () => {
    const all = texts(
      <TemplateReviewCampaigns campaigns={[campaign({ targetAudience: 'selected', audienceSize: 3 })]} />
    )
    expect(all).toContain('campaignAudienceSelected:{"count":3}')
  })

  describe('schedule label', () => {
    const label = (overrides: Partial<TemplateReviewDetailCampaign>) =>
      texts(<TemplateReviewCampaigns campaigns={[campaign(overrides)]} />)

    it('shows the localized status for a completed or failed campaign', () => {
      expect(label({ status: 'completed', scheduledAt: '2026-11-10T02:00:00Z' })).toContain('campaignScheduleSent')
      expect(label({ status: 'failed', schedule: { trigger: 'birthday' } })).toContain('campaignScheduleFailed')
    })

    it('says Automatic for a trigger/recurring schedule', () => {
      expect(label({ status: 'active', schedule: { trigger: 'birthday' } })).toContain('campaignAutomatic')
    })

    it('says Scheduled <date> for a one-off scheduledAt, formatted by next-intl for the active locale in HK time', () => {
      const all = label({ scheduledAt: '2026-11-10T02:00:00Z' })
      expect(all).toContain('campaignScheduled:{"date":"fmt(2026-11-10T02:00:00.000Z,Asia/Hong_Kong)"}')
      expect(dateTime).toHaveBeenCalled()
    })

    it('says Manual send otherwise — never Send now', () => {
      const all = label({})
      expect(all).toContain('campaignManualSend')
      expect(all).not.toContain('campaignSendNow')
    })
  })
})
