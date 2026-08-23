import { describe, it, expect, vi } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}))

import { TemplateReviewTable } from '@/components/admin/template-review-table'
import type { TemplateReviewItem } from '@/hooks/use-admin-template-reviews'

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

function renderTree(element: ReactElement): ReactElement[] {
  const fn = element.type as (p: unknown) => ReactNode
  return [...flatten(fn(element.props))]
}

function review(overrides: Partial<TemplateReviewItem> = {}): TemplateReviewItem {
  return {
    id: 'rev-1',
    restaurantId: 'rest-kushiro',
    templateId: 'tpl-1',
    templateName: '5th_anniversary',
    targetAudienceSize: 240,
    targetAudienceQuery: null,
    contentPreview: 'Come celebrate our 5th anniversary with 20% off!',
    status: 'pending',
    submittedBy: 'user-1',
    submittedAt: '2026-08-20T00:00:00Z',
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    ...overrides,
  }
}

describe('TemplateReviewTable', () => {
  it('shows the empty state when there are no reviews', () => {
    const tree = renderTree(<TemplateReviewTable reviews={[]} onReview={() => {}} />)
    const empty = tree.find((el) => typeof el.props === 'object' && (el.props as { children?: unknown }).children === 't:noReviews')
    expect(empty).toBeDefined()
  })

  it('renders tenant, template name, audience size, content preview and date', () => {
    const tree = renderTree(
      <TemplateReviewTable reviews={[review()]} onReview={() => {}} />
    )
    const cells = tree.filter((el) => typeof el.type === 'function' && el.type.name === 'TableCell')
    const texts = cells.map((c) => (c.props as { children?: unknown }).children)
    expect(texts).toContain('rest-kushiro')
    expect(texts).toContain('5th_anniversary')
    expect(texts).toContain(240)
    expect(texts).toContain('Come celebrate our 5th anniversary with 20% off!')
  })

  it('falls back to a dash when audience size is unknown', () => {
    const tree = renderTree(
      <TemplateReviewTable reviews={[review({ targetAudienceSize: null })]} onReview={() => {}} />
    )
    const cells = tree.filter((el) => typeof el.type === 'function' && el.type.name === 'TableCell')
    const texts = cells.map((c) => (c.props as { children?: unknown }).children)
    expect(texts).toContain('—')
  })

  it('calls onReview with the row when the review button fires', () => {
    const onReview = vi.fn()
    const r = review()
    const tree = renderTree(<TemplateReviewTable reviews={[r]} onReview={onReview} />)
    const button = tree.find((el) => typeof el.type === 'function' && el.type.name === 'Button')
    ;(button?.props as { onClick: () => void }).onClick()
    expect(onReview).toHaveBeenCalledWith(r)
  })
})
