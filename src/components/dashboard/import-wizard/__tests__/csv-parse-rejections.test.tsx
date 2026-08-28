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

import { CsvParseRejections } from '@/components/dashboard/import-wizard/csv-parse-rejections'
import type { CsvParseReject } from '@/components/dashboard/import-wizard/parse-csv'

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

function renderTree(element: ReactElement | null): ReactElement[] {
  if (element === null) return []
  const fn = element.type as (p: unknown) => ReactNode
  return [...flatten(fn(element.props))]
}

function attr(el: ReactElement, name: string): unknown {
  return (el.props as Record<string, unknown>)[name]
}

describe('CsvParseRejections — T-A3.1 empty', () => {
  it('renders null when there is nothing rejected', () => {
    const result = CsvParseRejections({ rejected: [] })
    expect(result).toBeNull()
  })
})

describe('CsvParseRejections — T-A3.2 one <li> per reject', () => {
  it('renders each reject with data-reject-reason, data-reject-line, and the composed message', () => {
    const rejected: CsvParseReject[] = [
      { line: 2, reason: 'column_count_mismatch', expected: 4, actual: 5, phone: '+85290001234' },
    ]
    const tree = renderTree(<CsvParseRejections rejected={rejected} />)
    const items = tree.filter((el) => el.type === 'li')
    expect(items).toHaveLength(1)
    expect(attr(items[0], 'data-reject-reason')).toBe('column_count_mismatch')
    expect(attr(items[0], 'data-reject-line')).toBe(2)

    const text = (attr(items[0], 'children') as unknown[]).join('')
    expect(text).toContain('t:csv.rejectLine:{"line":2}')
    expect(text).toContain('+85290001234')
    expect(text).toContain('t:csv.reason.column_count_mismatch:{"expected":4,"actual":5,"direction":"more"}')
  })

  it('renders an empty phone as an empty string, not "null"', () => {
    const rejected: CsvParseReject[] = [
      { line: 5, reason: 'unterminated_quote', expected: 4, actual: 2, phone: null },
    ]
    const tree = renderTree(<CsvParseRejections rejected={rejected} />)
    const item = tree.find((el) => el.type === 'li') as ReactElement
    const text = (attr(item, 'children') as unknown[]).join('')
    expect(text).not.toContain('null')
  })
})

describe('CsvParseRejections — T-A3.3 title + DOM hook', () => {
  it('renders the rejectedTitle headline with the count and carries data-section="csv-parse-rejections"', () => {
    const rejected: CsvParseReject[] = [
      { line: 2, reason: 'column_count_mismatch', expected: 4, actual: 5, phone: '+85290001234' },
      { line: 4, reason: 'unterminated_quote', expected: 4, actual: 1, phone: null },
    ]
    const tree = renderTree(<CsvParseRejections rejected={rejected} />)
    expect(tree.some((el) => attr(el, 'data-section') === 'csv-parse-rejections')).toBe(true)
    const headline = tree.find((el) => attr(el, 'children') === `t:csv.rejectedTitle:{"count":2}`)
    expect(headline).toBeDefined()
  })
})

describe('CsvParseRejections — T-A3.4 render cap + scroll', () => {
  it('renders at most 500 <li> and shows csv.showingFirst above the cap', () => {
    const rejected: CsvParseReject[] = Array.from({ length: 700 }, (_, i) => ({
      line: i + 2,
      reason: 'column_count_mismatch' as const,
      expected: 4,
      actual: 5,
      phone: null,
    }))
    const tree = renderTree(<CsvParseRejections rejected={rejected} />)
    const items = tree.filter((el) => el.type === 'li')
    expect(items).toHaveLength(500)
    const note = tree.find(
      (el) => attr(el, 'children') === `t:csv.showingFirst:{"shown":500,"count":700}`
    )
    expect(note).toBeDefined()
  })

  it('shows no "showing first" note at or under the cap', () => {
    const rejected: CsvParseReject[] = Array.from({ length: 500 }, (_, i) => ({
      line: i + 2,
      reason: 'column_count_mismatch' as const,
      expected: 4,
      actual: 5,
      phone: null,
    }))
    const tree = renderTree(<CsvParseRejections rejected={rejected} />)
    const note = tree.find((el) => attr(el, 'data-info') === 'rows-capped')
    expect(note).toBeUndefined()
  })

  it('applies a scroll class above the ~50 entry threshold', () => {
    const rejected: CsvParseReject[] = Array.from({ length: 60 }, (_, i) => ({
      line: i + 2,
      reason: 'column_count_mismatch' as const,
      expected: 4,
      actual: 5,
      phone: null,
    }))
    const tree = renderTree(<CsvParseRejections rejected={rejected} />)
    const list = tree.find((el) => el.type === 'ul')
    expect(String(attr(list as ReactElement, 'className'))).toContain('overflow-y-auto')
  })
})
