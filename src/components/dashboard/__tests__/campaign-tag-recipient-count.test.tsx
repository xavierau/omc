import { describe, it, expect, vi } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'

// This project runs vitest in a node env (no DOM/RTL), so component tests
// call the component function directly and walk the returned tree
// (mirrors campaign-member-picker-view.test.tsx). CampaignTagRecipientCount
// calls useTagRecipientCount internally, so that hook is mocked out —
// exactly like TagCombobox is stubbed in member-tags-section.test.tsx —
// to avoid invoking React's hook dispatcher outside of a real render. The
// debounce/abort/race logic the hook wraps is exercised directly, with
// fake timers, in use-tag-recipient-count.test.ts.

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `t:${key}:${JSON.stringify(vars)}` : `t:${key}`,
}))

const h = vi.hoisted(() => ({ useTagRecipientCount: vi.fn() }))
vi.mock('@/hooks/use-tag-recipient-count', () => ({
  useTagRecipientCount: h.useTagRecipientCount,
}))

import { CampaignTagRecipientCount } from '@/components/dashboard/campaign-tag-recipient-count'

interface ParagraphProps {
  'data-field'?: string
  'data-state'?: string
  children?: unknown
}

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

describe('CampaignTagRecipientCount', () => {
  it('renders nothing when no tags are selected (count: null, not loading)', () => {
    h.useTagRecipientCount.mockReturnValue({ count: null, isLoading: false, error: false })
    const tree = renderTree(<CampaignTagRecipientCount tagIds={[]} />)
    expect(tree).toHaveLength(0)
  })

  it('renders the loading line while counting', () => {
    h.useTagRecipientCount.mockReturnValue({ count: null, isLoading: true, error: false })
    const tree = renderTree(<CampaignTagRecipientCount tagIds={['t-1']} />)
    const p = tree[0].props as ParagraphProps
    expect(p['data-field']).toBe('recipient-count')
    expect(p['data-state']).toBe('loading')
    expect(p.children).toBe('t:recipientCountLoading')
  })

  it('renders the count on success', () => {
    h.useTagRecipientCount.mockReturnValue({ count: 42, isLoading: false, error: false })
    const tree = renderTree(<CampaignTagRecipientCount tagIds={['t-1']} />)
    const p = tree[0].props as ParagraphProps
    expect(p['data-state']).toBe('ok')
    expect(p.children).toBe('t:recipientCount:{"count":42}')
  })

  it('renders the zero-count warning without an error state (T-F3.5)', () => {
    h.useTagRecipientCount.mockReturnValue({ count: 0, isLoading: false, error: false })
    const tree = renderTree(<CampaignTagRecipientCount tagIds={['t-1']} />)
    const p = tree[0].props as ParagraphProps
    expect(p['data-state']).toBe('zero')
    expect(p.children).toBe('t:recipientCountZero')
  })

  it('renders the error line when the count request fails (T-F3.6)', () => {
    h.useTagRecipientCount.mockReturnValue({ count: null, isLoading: false, error: true })
    const tree = renderTree(<CampaignTagRecipientCount tagIds={['t-1']} />)
    const p = tree[0].props as ParagraphProps
    expect(p['data-state']).toBe('error')
    expect(p.children).toBe('t:recipientCountError')
  })

  it('prioritises loading over a stale count/error from a prior selection', () => {
    h.useTagRecipientCount.mockReturnValue({ count: 5, isLoading: true, error: false })
    const tree = renderTree(<CampaignTagRecipientCount tagIds={['t-1', 't-2']} />)
    expect((tree[0].props as ParagraphProps)['data-state']).toBe('loading')
  })
})
