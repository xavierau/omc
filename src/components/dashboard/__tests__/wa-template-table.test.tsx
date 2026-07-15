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

import { WaTemplateTable } from '@/components/dashboard/wa-template-table'
import type { WaTemplate } from '@/hooks/use-wa-templates'

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

function byTestId(tree: ReactElement[], id: string): ReactElement | undefined {
  return tree.find((el) => (el.props as Record<string, unknown>)['data-testid'] === id)
}

function template(overrides: Partial<WaTemplate> = {}): WaTemplate {
  return {
    id: 'tpl-1',
    name: 'welcome_offer',
    language: 'en',
    category: 'MARKETING',
    status: 'draft',
    components: [],
    createdAt: '2026-07-15T00:00:00Z',
    ...overrides,
  }
}

const REASON = 'BODY is missing expected field(s) (example) (code 100, subcode 2388043)'

describe('WaTemplateTable rejection reason', () => {
  it('shows the reason under a rejected row', () => {
    const tree = renderTree(
      <WaTemplateTable templates={[template({ status: 'rejected', rejectionReason: REASON })]} />
    )
    const note = byTestId(tree, 'rejection-reason')
    expect(note).toBeDefined()
    expect((note?.props as { title?: string }).title).toBe(REASON)
  })

  it("renders Meta's words verbatim in the reason note", () => {
    const tree = renderTree(
      <WaTemplateTable templates={[template({ status: 'rejected', rejectionReason: REASON })]} />
    )
    const note = byTestId(tree, 'rejection-reason')
    const children = (note?.props as { children?: ReactNode }).children
    expect(JSON.stringify(children)).toContain(REASON)
  })

  it('hangs the reason off the status badge as a tooltip', () => {
    const tree = renderTree(
      <WaTemplateTable templates={[template({ status: 'rejected', rejectionReason: REASON })]} />
    )
    const badge = tree.find(
      (el) => typeof el.type === 'function' && el.type.name === 'Badge'
    )
    expect((badge?.props as { title?: string }).title).toBe(REASON)
  })

  it('shows no reason element for an approved row', () => {
    const tree = renderTree(<WaTemplateTable templates={[template({ status: 'approved' })]} />)
    expect(byTestId(tree, 'rejection-reason')).toBeUndefined()
  })

  it('shows no reason element for a rejected row Meta gave no reason for', () => {
    const tree = renderTree(
      <WaTemplateTable templates={[template({ status: 'rejected', rejectionReason: null })]} />
    )
    expect(byTestId(tree, 'rejection-reason')).toBeUndefined()
  })

  it('does not leak a reason onto a non-rejected row that still carries one', () => {
    const tree = renderTree(
      <WaTemplateTable templates={[template({ status: 'pending', rejectionReason: REASON })]} />
    )
    expect(byTestId(tree, 'rejection-reason')).toBeUndefined()
  })
})
