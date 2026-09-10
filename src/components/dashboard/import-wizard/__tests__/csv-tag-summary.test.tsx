import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

const h = vi.hoisted(() => {
  const state = { queue: [] as unknown[], idx: 0 }
  const useState = (initial: unknown): [unknown, () => void] => {
    const value = state.idx < state.queue.length ? state.queue[state.idx] : initial
    state.idx++
    return [value, () => {}]
  }
  return { state, useState, useEffect: () => {}, fetchTags: vi.fn() }
})

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: h.useState as unknown as typeof actual.useState,
    useEffect: h.useEffect as unknown as typeof actual.useEffect,
  }
})

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `t:${key}:${JSON.stringify(params)}` : `t:${key}`,
}))

vi.mock('@/hooks/tag-client', () => ({
  fetchTags: h.fetchTags,
}))

import { CsvTagSummary } from '@/components/dashboard/import-wizard/csv-tag-summary'

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

function seed(existingTags: unknown[]) {
  h.state.queue = [existingTags]
  h.state.idx = 0
}

describe('CsvTagSummary — T-F1.11 no tags at all', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders nothing when no accepted row carries a tag', () => {
    seed([])
    const result = CsvTagSummary({ rows: [{ phoneE164: '+85291111111', name: null, grade: 'strong', tags: [] }] })
    expect(result).toBeNull()
  })
})

describe('CsvTagSummary — chips and new badges', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders a chip per distinct tag and marks unseen tags as new', () => {
    seed([{ id: 't1', name: 'vip' }])
    const rows = [
      { phoneE164: '+85291111111', name: null, grade: 'strong' as const, tags: ['vip'] },
      { phoneE164: '+85292222222', name: null, grade: 'strong' as const, tags: ['lunch'] },
    ]
    const tree = renderTree(<CsvTagSummary rows={rows} />)
    const chips = tree.filter((el) => attr(el, 'data-tag-new') !== undefined)
    expect(chips.length).toBe(2)
    const vipChip = chips.find((el) => JSON.stringify(attr(el, 'children')).includes('vip'))
    const lunchChip = chips.find((el) => JSON.stringify(attr(el, 'children')).includes('lunch'))
    expect(attr(vipChip as ReactElement, 'data-tag-new')).toBe('false')
    expect(attr(lunchChip as ReactElement, 'data-tag-new')).toBe('true')
  })

  it('renders the "N new tags will be created" line only when at least one tag is new', () => {
    seed([])
    const rows = [{ phoneE164: '+85291111111', name: null, grade: 'strong' as const, tags: ['vip', 'lunch'] }]
    const tree = renderTree(<CsvTagSummary rows={rows} />)
    const newCountLine = tree.find(
      (el) => attr(el, 'children') === 't:tagSummary.newCount:{"count":2}'
    )
    expect(newCountLine).toBeDefined()
  })

  it('carries data-section="csv-tag-summary" when rendering', () => {
    seed([])
    const rows = [{ phoneE164: '+85291111111', name: null, grade: 'strong' as const, tags: ['vip'] }]
    const tree = renderTree(<CsvTagSummary rows={rows} />)
    expect(tree.some((el) => attr(el, 'data-section') === 'csv-tag-summary')).toBe(true)
  })
})
