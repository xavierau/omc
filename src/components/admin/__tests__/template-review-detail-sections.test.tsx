import { describe, it, expect, vi } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useFormatter: () => ({ dateTime: (d: Date) => d.toISOString() }),
}))

import { TemplateReviewDetailSections } from '@/components/admin/template-review-detail-sections'
import { DecisionButtons } from '@/components/admin/template-review-decision-buttons'
import { Button } from '@/components/ui/button'
import type { TemplateReviewItem } from '@/hooks/use-admin-template-reviews'
import type { TemplateReviewDetail } from '@/hooks/use-admin-template-review-detail'

function flatten(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = []
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return
    out.push(child)
    if (typeof child.type === 'function' && child.type !== Button) {
      const fn = child.type as (p: unknown) => ReactNode
      out.push(...flatten(fn(child.props)))
      return
    }
    const props = child.props as { children?: ReactNode }
    if (props.children !== undefined) out.push(...flatten(props.children))
  })
  return out
}

const testId = (el: ReactElement) => (el.props as { 'data-testid'?: string })['data-testid']
const text = (el: ReactElement) => {
  const c = (el.props as { children?: unknown }).children
  return typeof c === 'string' ? c : null
}

function review(overrides: Partial<TemplateReviewItem> = {}): TemplateReviewItem {
  return {
    id: 'rev-1',
    restaurantId: 'rest-1',
    templateId: 'tpl-1',
    templateName: 'nov_promo_2026',
    targetAudienceSize: 1234,
    targetAudienceQuery: null,
    contentPreview: 'Submitted body text',
    status: 'pending',
    submittedBy: 'u-1',
    submittedAt: '2026-11-01T00:00:00Z',
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    restaurantName: 'Bicho',
    submitterEmail: 'owner@bicho.hk',
    ...overrides,
  }
}

function detail(overrides: Partial<TemplateReviewDetail> = {}): TemplateReviewDetail {
  return {
    review: review(),
    template: {
      id: 'tpl-1',
      name: 'nov_promo_2026',
      language: 'zh_HK',
      category: 'MARKETING',
      status: 'approved',
      components: [{ type: 'BODY', text: 'Current body' }],
    },
    campaigns: [],
    campaignsError: false,
    ...overrides,
  } as TemplateReviewDetail
}

type State = Parameters<typeof TemplateReviewDetailSections>[0]['state']
const loading: State = { detail: null, isLoading: true, error: null, refetch: () => {} }
const failed: State = { detail: null, isLoading: false, error: 'boom', refetch: () => {} }
const loaded = (d: TemplateReviewDetail): State => ({ detail: d, isLoading: false, error: null, refetch: () => {} })

function render(r: TemplateReviewItem, state: State) {
  return flatten((TemplateReviewDetailSections as (p: unknown) => ReactNode)({ review: r, state }))
}

function indexOfTestId(tree: ReactElement[], id: string) {
  return tree.findIndex((el) => testId(el) === id)
}

describe('TemplateReviewDetailSections', () => {
  it.each([
    ['loading', loading],
    ['error', failed],
    ['loaded', loaded(detail())],
  ])('always shows the submitted content (%s)', (_name, state) => {
    const tree = render(review(), state)
    const i = indexOfTestId(tree, 'template-review-submitted-content')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(tree.slice(i).map(text)).toContain('Submitted body text')
  })

  it('puts the submitted content above the current-template preview, which is labelled as possibly different', () => {
    const tree = render(review(), loaded(detail()))
    const submitted = indexOfTestId(tree, 'template-review-submitted-content')
    const preview = indexOfTestId(tree, 'template-review-preview')
    expect(preview).toBeGreaterThan(submitted)
    expect(tree.map(text)).toContain('sectionCurrentTemplate')
  })

  it('says the template record could not be loaded (not that it does not exist) and offers retry', () => {
    const refetch = vi.fn()
    const tree = render(review(), { ...loaded(detail({ template: null, campaigns: null })), refetch })
    const i = indexOfTestId(tree, 'template-review-template-missing')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(indexOfTestId(tree, 'template-review-preview')).toBe(-1)
    const notice = tree.slice(i)
    expect(notice.map(text)).toContain('templateUnavailable')
    expect(tree.map(text)).not.toContain('templateMissing')
    const retry = notice.find((el) => el.type === Button)
    expect(retry).toBeDefined()
    ;(retry!.props as { onClick: () => void }).onClick()
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('does not claim "no campaigns" when the template could not be loaded', () => {
    const tree = render(review(), loaded(detail({ template: null, campaigns: null })))
    expect(indexOfTestId(tree, 'template-review-campaigns-empty')).toBe(-1)
  })

  it('shows a short campaigns-error notice instead of failing the panel', () => {
    const tree = render(review(), loaded(detail({ campaigns: null, campaignsError: true })))
    const i = indexOfTestId(tree, 'template-review-campaigns-error')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(tree.slice(i).map(text)).toContain('campaignsError')
    expect(indexOfTestId(tree, 'template-review-preview')).toBeGreaterThanOrEqual(0)
    expect(indexOfTestId(tree, 'template-review-campaigns-empty')).toBe(-1)
  })

  it('takes restaurant name and submitter email from the list row only', () => {
    const tree = render(review({ restaurantName: null, submitterEmail: null }), loaded(detail()))
    const all = tree.map(text)
    expect(all).toContain('rest-1')
    expect(all).toContain('panelSubmitterUnknown')
  })

  it('says so when the submission carried no text', () => {
    const tree = render(review({ contentPreview: null }), loading)
    expect(tree.map(text)).toContain('submittedContentEmpty')
  })

  it('shows the submitted audience size in the summary', () => {
    const tree = render(review(), loading)
    expect(tree.map(text)).toContain('panelSubmittedAudience')
    expect(tree.map(text)).toContain('1,234')
    const none = render(review({ targetAudienceSize: null }), loading).map(text)
    expect(none).toContain('panelSubmittedAudience')
  })

  it('keeps the loading and error testids', () => {
    expect(indexOfTestId(render(review(), loading), 'template-review-detail-loading')).toBeGreaterThanOrEqual(0)
    expect(indexOfTestId(render(review(), failed), 'template-review-detail-error')).toBeGreaterThanOrEqual(0)
  })
})

describe('DecisionButtons', () => {
  const t = (k: string) => k
  const buttons = (props: Partial<Parameters<typeof DecisionButtons>[0]>) =>
    flatten(
      (DecisionButtons as (p: unknown) => ReactNode)({
        submittingAction: null,
        locked: false,
        onDecide: () => {},
        t,
        ...props,
      })
    ).filter((el) => el.type === Button)

  it('disables Approve / Reject / Request changes while the detail is loading', () => {
    const all = buttons({ locked: true })
    expect(all).toHaveLength(3)
    expect(all.every((b) => (b.props as { disabled?: boolean }).disabled === true)).toBe(true)
  })

  it('enables them once loading ends (loaded or errored)', () => {
    const all = buttons({ locked: false })
    expect(all.every((b) => (b.props as { disabled?: boolean }).disabled === false)).toBe(true)
  })

  it('disables them while a decision is in flight', () => {
    const all = buttons({ submittingAction: 'approve' })
    expect(all.every((b) => (b.props as { disabled?: boolean }).disabled === true)).toBe(true)
  })
})
