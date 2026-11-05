/**
 * QA (acceptance) — T-F1.5 / A17 / Performance Budget
 * "Merge-checkbox toggle on the preview step → 0 network requests".
 *
 * The frozen dev suite proves the merge SEMANTICS (preview-warning-helpers)
 * and that the warning lines re-render (preview-warnings), but nothing
 * asserted the budget itself: that flipping the checkbox costs no request.
 *
 * Added by qa-engineer during acceptance verification; not part of the frozen
 * dev suite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
import { buildPreviewWarnings } from '@/components/dashboard/import-wizard/preview-warning-helpers'
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

const ROWS = [
  { phoneE164: '+85291234567', grade: 'strong' as const, name: 'A', tags: [] as string[] },
  { phoneE164: '+85291234568', grade: 'strong' as const, name: 'B', tags: [] as string[] },
  { phoneE164: '+85291234569', grade: 'strong' as const, name: 'C', tags: [] as string[] },
]

// +...567 is an existing member only  → merge OFF: skipped; merge ON: merged.
// +...568 holds active consent only   → skipped in BOTH modes (AM-4).
const LOOKUPS: PreviewLookups = {
  alreadyMemberPhones: ['+85291234567'],
  activeConsentPhones: ['+85291234568'],
  status: 'ok',
}

function props(merge: boolean, onMergeChange: (m: boolean) => void) {
  return {
    rows: ROWS,
    rejected: [],
    gradeBreakdown: { strong: 3, medium: 0, weak: 0, none: 0 },
    lookups: LOOKUPS,
    mergeExistingMembers: merge,
    onMergeChange,
    onBack: () => {},
    onNext: () => {},
  }
}

describe('preview merge toggle — zero network requests (T-F1.5, A17)', () => {
  const fetchSpy = vi.fn()
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    fetchSpy.mockReset()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('flipping the merge checkbox issues no fetch and only reports the new value upward', () => {
    const onMergeChange = vi.fn()
    const tree = renderTree(<StepGradePreview {...props(false, onMergeChange)} />)
    const checkbox = tree.find((el) => attr(el, 'data-field') === 'merge')
    expect(checkbox).toBeDefined()

    const onChange = attr(checkbox!, 'onChange') as (e: unknown) => void
    onChange({ target: { checked: true } })

    expect(onMergeChange).toHaveBeenCalledWith(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('re-rendering with the flipped value recomputes the row highlight locally, still with no fetch', () => {
    const offTree = renderTree(<StepGradePreview {...props(false, () => {})} />)
    const onTree = renderTree(<StepGradePreview {...props(true, () => {})} />)

    const warned = (tree: ReactElement[]) =>
      tree
        .filter((el) => attr(el, 'data-row') !== undefined && attr(el, 'data-warned') === 'true')
        .map((el) => attr(el, 'data-row'))

    // Both phones stay flagged in both modes; what changes is the counts, and
    // the recompute happens in-process.
    expect(warned(offTree)).toEqual(['+85291234567', '+85291234568'])
    expect(warned(onTree)).toEqual(['+85291234567', '+85291234568'])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the counts actually change across the toggle (guards against a vacuous no-fetch assertion)', () => {
    const off = buildPreviewWarnings({ rows: ROWS, lookups: LOOKUPS, merge: false })
    const on = buildPreviewWarnings({ rows: ROWS, lookups: LOOKUPS, merge: true })

    expect(off).toMatchObject({ willMerge: 0, willSkipAlreadyMember: 1, willSkipActiveConsent: 1 })
    expect(on).toMatchObject({ willMerge: 1, willSkipAlreadyMember: 0, willSkipActiveConsent: 1 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
