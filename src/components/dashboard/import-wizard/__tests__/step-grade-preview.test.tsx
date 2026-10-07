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

import { StepGradePreview } from '@/components/dashboard/import-wizard/step-grade-preview'
import { GradeBadge } from '@/components/dashboard/import-wizard/grade-badge'
import { PreviewRejectionsPanel } from '@/components/dashboard/import-wizard/preview-rejections-panel'
import { CsvTagSummary } from '@/components/dashboard/import-wizard/csv-tag-summary'
import { PreviewWarnings } from '@/components/dashboard/import-wizard/preview-warnings'
import type { PreviewLookups } from '@/hooks/use-import-batch'

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

const OK_LOOKUPS: PreviewLookups = {
  alreadyMemberPhones: [],
  activeConsentPhones: [],
  status: 'ok',
}

const baseProps = {
  rows: [
    { phoneE164: '+85291234567', grade: 'strong' as const, name: 'A', tags: [] as string[] },
    { phoneE164: '+85291234568', grade: 'medium' as const, name: 'B', tags: [] as string[] },
    { phoneE164: '+85291234569', grade: 'weak' as const, name: null, tags: [] as string[] },
  ],
  rejected: [],
  gradeBreakdown: { strong: 1, medium: 1, weak: 1, none: 0 },
  lookups: OK_LOOKUPS,
  mergeExistingMembers: false,
  onMergeChange: () => {},
  onBack: () => {},
  onNext: () => {},
}

describe('StepGradePreview — grade breakdown + table (pre-existing behaviour)', () => {
  it('renders one breakdown tile per grade key', () => {
    const tree = renderTree(<StepGradePreview {...baseProps} />)
    const tiles = tree.filter((el) => attr(el, 'data-breakdown') !== undefined)
    expect(tiles.map((el) => attr(el, 'data-breakdown'))).toEqual([
      'strong',
      'medium',
      'weak',
      'none',
    ])
  })

  it('renders one grade badge per row in the table', () => {
    const tree = renderTree(<StepGradePreview {...baseProps} />)
    expect(tree.filter((el) => el.type === GradeBadge).length).toBe(3)
  })

  it('shows the merge toggle wired to onMergeChange', () => {
    const tree = renderTree(<StepGradePreview {...baseProps} />)
    const checkbox = tree.find((el) => attr(el, 'data-field') === 'merge')
    expect(checkbox).toBeDefined()
    expect(attr(checkbox as ReactElement, 'checked')).toBe(false)
  })
})

describe('StepGradePreview — T-F1.12: unreachable highlight is gone (A20)', () => {
  it('never renders a data-rejected attribute anywhere in the tree', () => {
    const tree = renderTree(
      <StepGradePreview
        {...baseProps}
        rejected={[{ phoneE164: '+85299999999', reason: 'duplicate_phone_in_batch' as const }]}
      />
    )
    expect(tree.some((el) => attr(el, 'data-rejected') !== undefined)).toBe(false)
  })
})

describe('StepGradePreview — mounts PreviewRejectionsPanel wired to rejected + accepted count', () => {
  it('passes rejected and acceptedCount (rows.length) through', () => {
    const rejected = [{ phoneE164: '+85299999999', reason: 'invalid_phone' as const }]
    const tree = renderTree(<StepGradePreview {...baseProps} rejected={rejected} />)
    const panel = tree.find((el) => el.type === PreviewRejectionsPanel)
    expect(panel).toBeDefined()
    expect(attr(panel as ReactElement, 'rejected')).toBe(rejected)
    expect(attr(panel as ReactElement, 'acceptedCount')).toBe(baseProps.rows.length)
  })
})

describe('StepGradePreview — mounts CsvTagSummary wired to rows', () => {
  it('passes rows through to CsvTagSummary', () => {
    const tree = renderTree(<StepGradePreview {...baseProps} />)
    const summary = tree.find((el) => el.type === CsvTagSummary)
    expect(summary).toBeDefined()
    expect(attr(summary as ReactElement, 'rows')).toBe(baseProps.rows)
  })
})

describe('StepGradePreview — mounts PreviewWarnings wired to rows/lookups/merge', () => {
  it('passes rows, lookups and merge through', () => {
    const lookups: PreviewLookups = {
      alreadyMemberPhones: ['+85291234567'],
      activeConsentPhones: [],
      status: 'ok',
    }
    const tree = renderTree(
      <StepGradePreview {...baseProps} lookups={lookups} mergeExistingMembers />
    )
    const warnings = tree.find((el) => el.type === PreviewWarnings)
    expect(warnings).toBeDefined()
    expect(attr(warnings as ReactElement, 'rows')).toBe(baseProps.rows)
    expect(attr(warnings as ReactElement, 'lookups')).toBe(lookups)
    expect(attr(warnings as ReactElement, 'merge')).toBe(true)
  })
})

describe('StepGradePreview — row highlighting (AD-8 replacement)', () => {
  it('marks a warned row with data-warned="true" and leaves others untouched', () => {
    const lookups: PreviewLookups = {
      alreadyMemberPhones: ['+85291234567'],
      activeConsentPhones: [],
      status: 'ok',
    }
    const tree = renderTree(
      <StepGradePreview {...baseProps} lookups={lookups} mergeExistingMembers={false} />
    )
    const warnedRow = tree.find((el) => attr(el, 'data-row') === '+85291234567')
    const otherRow = tree.find((el) => attr(el, 'data-row') === '+85291234568')
    expect(attr(warnedRow as ReactElement, 'data-warned')).toBe('true')
    expect(attr(otherRow as ReactElement, 'data-warned')).toBeUndefined()
  })

  it('a row with no lookup match carries no data-warned attribute', () => {
    const tree = renderTree(<StepGradePreview {...baseProps} lookups={OK_LOOKUPS} />)
    const row = tree.find((el) => attr(el, 'data-row') === '+85291234567')
    expect(attr(row as ReactElement, 'data-warned')).toBeUndefined()
  })
})
