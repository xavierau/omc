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

const baseProps = {
  rows: [
    { phoneE164: '+85291234567', grade: 'strong' as const, name: 'A' },
    { phoneE164: '+85291234568', grade: 'medium' as const, name: 'B' },
    { phoneE164: '+85291234569', grade: 'weak' as const, name: null },
  ],
  rejected: [],
  gradeBreakdown: { strong: 1, medium: 1, weak: 1, none: 0 },
  mergeExistingMembers: false,
  onMergeChange: () => {},
  onBack: () => {},
  onNext: () => {},
}

describe('StepGradePreview', () => {
  it('renders one breakdown tile per grade key', () => {
    const tree = renderTree(<StepGradePreview {...baseProps} />)
    const tiles = tree.filter(
      (el) =>
        typeof el.props === 'object' &&
        (el.props as Record<string, unknown>)['data-breakdown'] !== undefined
    )
    const keys = tiles.map(
      (el) => (el.props as Record<string, unknown>)['data-breakdown']
    )
    expect(keys).toEqual(['strong', 'medium', 'weak', 'none'])
  })

  it('renders one grade badge per row in the table', () => {
    const tree = renderTree(<StepGradePreview {...baseProps} />)
    const badges = tree.filter((el) => el.type === GradeBadge)
    expect(badges.length).toBe(3)
  })

  it('shows merge toggle wired to onMergeChange', () => {
    const tree = renderTree(<StepGradePreview {...baseProps} />)
    const checkbox = tree.find(
      (el) =>
        typeof el.props === 'object' &&
        (el.props as Record<string, unknown>)['data-field'] === 'merge'
    )
    expect(checkbox).toBeDefined()
    expect((checkbox?.props as { checked?: boolean }).checked).toBe(false)
  })

  it('renders rejected row indicators when rejected list is non-empty', () => {
    const tree = renderTree(
      <StepGradePreview
        {...baseProps}
        rejected={[
          { phoneE164: '+85291234567', reason: 'duplicate_phone_in_batch' },
        ]}
      />
    )
    const rejectNodes = tree.filter(
      (el) =>
        typeof el.props === 'object' &&
        (el.props as Record<string, unknown>)['data-rejected'] !== undefined
    )
    expect(rejectNodes.length).toBeGreaterThan(0)
  })
})
