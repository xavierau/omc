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

import { StepConfirm } from '@/components/dashboard/import-wizard/step-confirm'
import { CommitRejectionsList } from '@/components/dashboard/import-wizard/commit-rejections-list'
import type { ImportContactsBatchResult } from '@/hooks/use-import-batch'

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

const baseResult: ImportContactsBatchResult = {
  importBatchId: 'batch-1',
  inserted: 8,
  membersCreated: 5,
  rejected: [],
  gradeBreakdown: { strong: 4, medium: 2, weak: 1, none: 1 },
  tagging: { status: 'ok', taggedMembers: 0 },
}

const noop = () => {}

describe('StepConfirm — existing rejected count line stays intact', () => {
  it('keeps data-stat="rejected" rendering result.rejected.length', () => {
    const result: ImportContactsBatchResult = {
      ...baseResult,
      rejected: [
        { phoneE164: '+85291111111', reason: 'invalid_phone' },
        { phoneE164: '+85292222222', reason: 'duplicate_active' },
      ],
    }
    const tree = renderTree(
      <StepConfirm
        isCommitting={false}
        result={result}
        error={null}
        onCommit={noop}
        onBack={noop}
        onDone={noop}
      />
    )
    const stat = tree.find((el) => attr(el, 'data-stat') === 'rejected')
    expect(stat).toBeDefined()
    expect(JSON.stringify(attr(stat as ReactElement, 'children'))).toContain('2')
  })
})

describe('StepConfirm — commit rejections list (T-F2 / IM-9)', () => {
  it('renders CommitRejectionsList with rejected rows and total = inserted + rejected.length when rejected is non-empty', () => {
    const result: ImportContactsBatchResult = {
      ...baseResult,
      inserted: 8,
      rejected: [
        { phoneE164: '+85291111111', reason: 'invalid_phone' },
        { phoneE164: '+85292222222', reason: 'duplicate_active' },
      ],
    }
    const tree = renderTree(
      <StepConfirm
        isCommitting={false}
        result={result}
        error={null}
        onCommit={noop}
        onBack={noop}
        onDone={noop}
      />
    )
    const list = tree.find((el) => el.type === CommitRejectionsList)
    expect(list).toBeDefined()
    expect(attr(list as ReactElement, 'rejected')).toEqual(result.rejected)
    expect(attr(list as ReactElement, 'total')).toBe(10)
  })

  it('does not render CommitRejectionsList when rejected is empty', () => {
    const tree = renderTree(
      <StepConfirm
        isCommitting={false}
        result={baseResult}
        error={null}
        onCommit={noop}
        onBack={noop}
        onDone={noop}
      />
    )
    const list = tree.find((el) => el.type === CommitRejectionsList)
    expect(list).toBeUndefined()
  })
})

describe('StepConfirm — tagged members line', () => {
  it('renders confirm.taggedMembers when tagging.taggedMembers > 0', () => {
    const result: ImportContactsBatchResult = {
      ...baseResult,
      tagging: { status: 'ok', taggedMembers: 6 },
    }
    const tree = renderTree(
      <StepConfirm
        isCommitting={false}
        result={result}
        error={null}
        onCommit={noop}
        onBack={noop}
        onDone={noop}
      />
    )
    const line = tree.find(
      (el) => attr(el, 'children') === `t:confirm.taggedMembers:{"count":6}`
    )
    expect(line).toBeDefined()
  })

  it('renders no tagged line when taggedMembers is 0', () => {
    const tree = renderTree(
      <StepConfirm
        isCommitting={false}
        result={baseResult}
        error={null}
        onCommit={noop}
        onBack={noop}
        onDone={noop}
      />
    )
    const line = tree.find((el) =>
      String(attr(el, 'children') ?? '').includes('confirm.taggedMembers')
    )
    expect(line).toBeUndefined()
  })
})

describe('StepConfirm — tags-failed warning', () => {
  it('renders the tagsFailed warning when tagging.status is "failed", and the success stats still render', () => {
    const result: ImportContactsBatchResult = {
      ...baseResult,
      tagging: { status: 'failed', taggedMembers: 0 },
    }
    const tree = renderTree(
      <StepConfirm
        isCommitting={false}
        result={result}
        error={null}
        onCommit={noop}
        onBack={noop}
        onDone={noop}
      />
    )
    const warning = tree.find((el) => attr(el, 'data-warning') === 'tags-failed')
    expect(warning).toBeDefined()
    expect(attr(warning as ReactElement, 'children')).toBe('t:confirm.tagsFailed')

    const successTitle = tree.find(
      (el) => attr(el, 'children') === 't:confirm.successTitle'
    )
    expect(successTitle).toBeDefined()
    const insertedStat = tree.find((el) => attr(el, 'data-stat') === 'strong')
    expect(insertedStat).toBeDefined()
  })

  it('does not render the warning when tagging.status is "ok"', () => {
    const tree = renderTree(
      <StepConfirm
        isCommitting={false}
        result={baseResult}
        error={null}
        onCommit={noop}
        onBack={noop}
        onDone={noop}
      />
    )
    const warning = tree.find((el) => attr(el, 'data-warning') === 'tags-failed')
    expect(warning).toBeUndefined()
  })
})

describe('StepConfirm — too_many_new_tags error copy (I-4)', () => {
  it('maps the raw "too_many_new_tags" reason to its translated copy', () => {
    const tree = renderTree(
      <StepConfirm
        isCommitting={false}
        result={null}
        error="too_many_new_tags"
        onCommit={noop}
        onBack={noop}
        onDone={noop}
      />
    )
    const line = tree.find((el) => attr(el, 'children') === 't:confirm.errors.too_many_new_tags')
    expect(line).toBeDefined()
    // The raw enum must never reach the user.
    const raw = tree.find((el) => attr(el, 'children') === 'too_many_new_tags')
    expect(raw).toBeUndefined()
  })

  it('falls back to the raw string for an unrecognised error reason', () => {
    const tree = renderTree(
      <StepConfirm
        isCommitting={false}
        result={null}
        error="Request failed (500)"
        onCommit={noop}
        onBack={noop}
        onDone={noop}
      />
    )
    const line = tree.find((el) => attr(el, 'children') === 'Request failed (500)')
    expect(line).toBeDefined()
  })
})
