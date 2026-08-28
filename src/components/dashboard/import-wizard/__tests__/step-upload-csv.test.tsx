import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

const h = vi.hoisted(() => {
  const state = { queue: [] as unknown[], idx: 0 }
  const setState = vi.fn()
  const useState = (initial: unknown): [unknown, typeof setState] => {
    const value = state.idx < state.queue.length ? state.queue[state.idx] : initial
    state.idx++
    return [value, setState]
  }
  return {
    state,
    useState,
    setState,
    // Same direct-call harness as commit-rejections-list.test.tsx: no active
    // fiber, so the real useRef would throw (no dispatcher).
    useRef: (initial: unknown) => ({ current: initial }),
  }
})

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: h.useState as unknown as typeof actual.useState,
    useRef: h.useRef as unknown as typeof actual.useRef,
  }
})

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `t:${key}:${JSON.stringify(params)}` : `t:${key}`,
}))

import { StepUploadCsv, EMPTY_CSV } from '@/components/dashboard/import-wizard/step-upload-csv'
import { CsvFormatHelp } from '@/components/dashboard/import-wizard/csv-format-help'
import { CsvParseRejections } from '@/components/dashboard/import-wizard/csv-parse-rejections'
import type { ParseCsvResult } from '@/components/dashboard/import-wizard/parse-csv'

const WIZARD_DIR = join(process.cwd(), 'src/components/dashboard/import-wizard')

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

function seed(error: string | null) {
  h.state.queue = [error]
  h.state.idx = 0
}

const onParsed = vi.fn()
const onBack = vi.fn()
const onNext = vi.fn()

beforeEach(() => {
  onParsed.mockClear()
  onBack.mockClear()
  onNext.mockClear()
})

describe('StepUploadCsv — T-A5.1 base render', () => {
  it('renders CsvFormatHelp, the picker, and keeps data-step="upload-csv"', () => {
    seed(null)
    const tree = renderTree(
      <StepUploadCsv parsed={EMPTY_CSV} onParsed={onParsed} onBack={onBack} onNext={onNext} />
    )
    expect(tree.some((el) => el.type === CsvFormatHelp)).toBe(true)
    expect(tree.some((el) => attr(el, 'data-action') === 'pick-csv')).toBe(true)
    expect(tree.some((el) => attr(el, 'data-step') === 'upload-csv')).toBe(true)
  })
})

describe('StepUploadCsv — T-A5.2 rejections panel wired', () => {
  it('passes parsed.rejected through to CsvParseRejections', () => {
    seed(null)
    const rejected: ParseCsvResult['rejected'] = [
      { line: 2, reason: 'column_count_mismatch', expected: 4, actual: 5, phone: '+85290001234' },
    ]
    const parsed: ParseCsvResult = { phoneHeaderFound: true, rows: [], rejected }
    const tree = renderTree(
      <StepUploadCsv parsed={parsed} onParsed={onParsed} onBack={onBack} onNext={onNext} />
    )
    const panel = tree.find((el) => el.type === CsvParseRejections) as ReactElement
    expect(panel).toBeDefined()
    expect(attr(panel, 'rejected')).toEqual(rejected)
  })
})

describe('StepUploadCsv — T-A5.3 all rows rejected', () => {
  it('disables Next and does not show csv.errors.empty', () => {
    seed(null)
    const rejected: ParseCsvResult['rejected'] = [
      { line: 2, reason: 'column_count_mismatch', expected: 4, actual: 5, phone: null },
    ]
    const parsed: ParseCsvResult = { phoneHeaderFound: true, rows: [], rejected }
    const tree = renderTree(
      <StepUploadCsv parsed={parsed} onParsed={onParsed} onBack={onBack} onNext={onNext} />
    )
    const next = tree.find((el) => attr(el, 'data-action') === 'next') as ReactElement
    expect(attr(next, 'disabled')).toBe(true)
    expect(tree.some((el) => attr(el, 'children') === 't:csv.errors.empty')).toBe(false)
  })
})

describe('StepUploadCsv — T-A5.4 rows and panel both present', () => {
  it('renders csv.rowCount and the rejections panel together', () => {
    seed(null)
    const rejected: ParseCsvResult['rejected'] = [
      { line: 3, reason: 'unterminated_quote', expected: 4, actual: 1, phone: null },
    ]
    const parsed: ParseCsvResult = {
      phoneHeaderFound: true,
      rows: [
        { phoneE164: '+85291234567', name: 'A', preferredLanguage: 'en', tags: [], ignoredTagCount: 0 },
      ],
      rejected,
    }
    const tree = renderTree(
      <StepUploadCsv parsed={parsed} onParsed={onParsed} onBack={onBack} onNext={onNext} />
    )
    expect(tree.some((el) => attr(el, 'data-info') === 'row-count')).toBe(true)
    const panel = tree.find((el) => el.type === CsvParseRejections) as ReactElement
    expect(attr(panel, 'rejected')).toEqual(rejected)
    const next = tree.find((el) => attr(el, 'data-action') === 'next') as ReactElement
    expect(attr(next, 'disabled')).toBe(false)
  })
})

describe('StepUploadCsv — T-A5.5 no network', () => {
  it('never references fetch in the step source', () => {
    const source = readFileSync(join(WIZARD_DIR, 'step-upload-csv.tsx'), 'utf-8')
    expect(source).not.toContain('fetch')
  })
})
