import { describe, it, expect, vi } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `t:${key}:${JSON.stringify(params)}` : `t:${key}`,
}))

import { PreviewRejectionsPanel } from '@/components/dashboard/import-wizard/preview-rejections-panel'

function flatten(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = []
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return
    out.push(child)
    const props = child.props as { children?: ReactNode }
    if (props.children !== undefined) out.push(...flatten(props.children))
  })
  return out
}

function renderTree(element: ReactElement): ReactElement[] {
  const fn = element.type as (p: unknown) => ReactNode
  return [...flatten(fn(element.props))]
}

function attr(el: ReactElement, name: string): unknown {
  return (el.props as Record<string, unknown>)[name]
}

describe('PreviewRejectionsPanel — T-F1.1 rejected non-empty', () => {
  it('renders one entry per rejected row with the reason label, and a count headline matching rejected.length', () => {
    const rejected = [
      { phoneE164: '+85291111111', reason: 'invalid_phone' as const },
      { phoneE164: '+85292222222', reason: 'duplicate_active' as const },
    ]
    const tree = renderTree(
      <PreviewRejectionsPanel rejected={rejected} acceptedCount={10} />
    )
    const entries = tree.filter((el) => attr(el, 'data-reject-reason') !== undefined)
    expect(entries.length).toBe(2)
    expect(attr(entries[0], 'data-reject-reason')).toBe('invalid_phone')
    expect(attr(entries[1], 'data-reject-reason')).toBe('duplicate_active')

    const headline = tree.find(
      (el) => attr(el, 'children') === `t:preview.rejectedTitle:{"count":2}`
    )
    expect(headline).toBeDefined()
  })

  it('each entry shows phone and the localized reason', () => {
    const rejected = [{ phoneE164: '+85291111111', reason: 'phone_already_member' as const }]
    const tree = renderTree(
      <PreviewRejectionsPanel rejected={rejected} acceptedCount={5} />
    )
    const entry = tree.find((el) => attr(el, 'data-reject-reason') === 'phone_already_member')
    expect(entry).toBeDefined()
    const children = attr(entry as ReactElement, 'children')
    expect(JSON.stringify(children)).toContain('+85291111111')
    expect(JSON.stringify(children)).toContain('t:preview.reason.phone_already_member')
  })
})

describe('PreviewRejectionsPanel — T-F1.2 rejected empty', () => {
  it('renders the success line and no reject-reason entries', () => {
    const tree = renderTree(<PreviewRejectionsPanel rejected={[]} acceptedCount={7} />)
    const success = tree.find(
      (el) => attr(el, 'children') === `t:preview.rejectedNone:{"count":7}`
    )
    expect(success).toBeDefined()
    const entries = tree.filter((el) => attr(el, 'data-reject-reason') !== undefined)
    expect(entries.length).toBe(0)
  })
})

describe('PreviewRejectionsPanel — DOM hook', () => {
  it('always carries data-section="preview-rejections" on its root, empty or not', () => {
    const empty = renderTree(<PreviewRejectionsPanel rejected={[]} acceptedCount={1} />)
    const nonEmpty = renderTree(
      <PreviewRejectionsPanel
        rejected={[{ phoneE164: '+85291111111', reason: 'invalid_phone' as const }]}
        acceptedCount={1}
      />
    )
    expect(empty.some((el) => attr(el, 'data-section') === 'preview-rejections')).toBe(true)
    expect(nonEmpty.some((el) => attr(el, 'data-section') === 'preview-rejections')).toBe(true)
  })

  it('scrolls above the ~50 entry threshold', () => {
    const rejected = Array.from({ length: 60 }, (_, i) => ({
      phoneE164: `+8529${String(i).padStart(7, '0')}`,
      reason: 'invalid_phone' as const,
    }))
    const tree = renderTree(<PreviewRejectionsPanel rejected={rejected} acceptedCount={0} />)
    const list = tree.find((el) => el.type === 'ul')
    expect(String(attr(list as ReactElement, 'className'))).toContain('overflow-y-auto')
  })
})

describe('PreviewRejectionsPanel — render cap (M-11)', () => {
  it('renders at most 500 rows and shows the "showing first" note above the cap', () => {
    const rejected = Array.from({ length: 700 }, (_, i) => ({
      phoneE164: `+8529${String(i).padStart(7, '0')}`,
      reason: 'invalid_phone' as const,
    }))
    const tree = renderTree(<PreviewRejectionsPanel rejected={rejected} acceptedCount={0} />)
    const entries = tree.filter((el) => attr(el, 'data-reject-reason') !== undefined)
    expect(entries.length).toBe(500)

    const note = tree.find(
      (el) => attr(el, 'children') === `t:preview.showingFirst:{"shown":500,"count":700}`
    )
    expect(note).toBeDefined()
  })

  it('does not show the "showing first" note at or under the cap', () => {
    const rejected = Array.from({ length: 500 }, (_, i) => ({
      phoneE164: `+8529${String(i).padStart(7, '0')}`,
      reason: 'invalid_phone' as const,
    }))
    const tree = renderTree(<PreviewRejectionsPanel rejected={rejected} acceptedCount={0} />)
    const note = tree.find((el) => attr(el, 'data-info') === 'rows-capped')
    expect(note).toBeUndefined()
  })
})
