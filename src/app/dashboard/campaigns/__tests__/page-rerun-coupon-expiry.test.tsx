import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import type { CouponConfig } from '@/domain/entities/campaign'

// CAMP-014: the expiry line is only hidden if the page tells the card, so this
// drives the real page, card and sheet together. No DOM renderer in this repo:
// useState is a cell store, as in campaign-card.test.tsx.
const h = vi.hoisted(() => {
  let cells: unknown[] = []
  let index = 0
  const useState = (initial: unknown): [unknown, (v: unknown) => void] => {
    const i = index++
    if (i >= cells.length) cells.push(initial)
    return [cells[i], (v) => { cells[i] = v }]
  }
  return {
    useState,
    useCampaigns: vi.fn(),
    rewind: () => { index = 0 },
    reset: () => { cells = []; index = 0 },
  }
})

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useState: h.useState }
})
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => `t:${key}` }))
vi.mock('@/hooks/use-campaigns', () => ({ useCampaigns: h.useCampaigns }))
vi.mock('@/hooks/use-campaign-guardrails', () => ({
  useCampaignGuardrails: () => ({ data: null }),
}))
vi.mock('@/components/dashboard/campaign-guardrail-banner', () => ({
  CampaignGuardrailBanner: () => null,
}))
vi.mock('@/components/dashboard/campaign-form-dialog', () => ({ CampaignFormDialog: () => null }))
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  SheetContent: ({ children }: { children: ReactNode }) => children,
  SheetHeader: ({ children }: { children: ReactNode }) => children,
  SheetTitle: ({ children }: { children: ReactNode }) => children,
}))

import CampaignsPage from '../page'
import { buildCampaign } from '@/test-utils/builders'

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

function render() {
  h.rewind()
  return flatten(CampaignsPage())
}

function openRerunSheet(couponConfig: CouponConfig | null) {
  h.useCampaigns.mockReturnValue({
    campaigns: [buildCampaign({ id: 'c-1', status: 'failed', couponConfig })],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })
  const button = render().find(
    (el) => (el.props as Record<string, unknown>)['data-testid'] === 'campaign-rerun-button'
  )
  ;(button?.props as { onClick: () => void }).onClick()
  return JSON.stringify(render().map((el) => (el.props as { children?: unknown }).children))
}

describe('CampaignsPage re-run sheet coupon expiry (CAMP-014)', () => {
  beforeEach(() => h.reset())

  it('shows the expiry line for a campaign with a coupon config', () => {
    const texts = openRerunSheet({ discountType: 'percentage', discountValue: 10, expiresInDays: 7 })

    expect(texts).toContain('t:rerunConfirmBody')
    expect(texts).toContain('t:rerunCouponExpiry')
  })

  it('hides the expiry line for a campaign without a coupon config', () => {
    const texts = openRerunSheet(null)

    expect(texts).toContain('t:rerunConfirmBody')
    expect(texts).not.toContain('t:rerunCouponExpiry')
  })
})
