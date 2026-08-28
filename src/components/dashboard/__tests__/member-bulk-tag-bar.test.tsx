import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

// Stateful component (tags, tagIds, busy, status — in that useState order).
// This project runs vitest in a node env (no DOM/RTL): mock useState with a
// queue (mirrors member-tags-section.test.tsx) and call the component
// function directly, walking the returned tree.
const h = vi.hoisted(() => {
  const state = { queue: [] as unknown[], idx: 0 }
  const useState = (initial: unknown): [unknown, () => void] => {
    const value = state.idx < state.queue.length ? state.queue[state.idx] : initial
    state.idx++
    return [value, () => {}]
  }
  return {
    state,
    useState,
    // The direct-call tree-walk pattern has no active fiber, so the real
    // useEffect throws (no dispatcher). It's a no-op here — the mount fetch
    // it would run is irrelevant since tests seed `tags` via the useState
    // queue directly.
    useEffect: () => {},
    bulkUpdateMemberTags: vi.fn(),
    fetchTags: vi.fn(),
  }
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
  useTranslations: () => {
    const fn = (key: string, vars?: Record<string, unknown>) =>
      vars ? `t:${key}:${JSON.stringify(vars)}` : `t:${key}`
    return fn
  },
}))

vi.mock('@/components/dashboard/tag-combobox', () => ({
  TagCombobox: () => null,
}))

vi.mock('@/hooks/tag-client', () => ({
  fetchTags: h.fetchTags,
}))

vi.mock('@/components/dashboard/member-bulk-tag-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/dashboard/member-bulk-tag-helpers')>()
  return { ...actual, bulkUpdateMemberTags: h.bulkUpdateMemberTags }
})

import { MemberBulkTagBar } from '@/components/dashboard/member-bulk-tag-bar'

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

function byType(tree: ReactElement[], name: string): ReactElement[] {
  return tree.filter((el) => typeof el.type === 'function' && el.type.name === name)
}

function textOf(el: ReactElement): unknown {
  return (el.props as { children?: unknown }).children
}

function hasText(tree: ReactElement[], text: string): boolean {
  return tree.some((el) => textOf(el) === text)
}

interface ButtonProps {
  children?: unknown
  disabled?: boolean
  onClick?: () => void | Promise<void>
}

// queue order: tags, tagIds, busy, status
function seed(tags: unknown[], tagIds: string[], busy: boolean, status: unknown) {
  h.state.queue = [tags, tagIds, busy, status]
  h.state.idx = 0
}

const TAGS = [
  { id: 't1', name: 'VIP' },
  { id: 't2', name: 'Lunch' },
]

describe('MemberBulkTagBar visibility', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders nothing when no members are selected', () => {
    seed(TAGS, [], false, null)
    const result = MemberBulkTagBar({ selectedIds: [], onClear: vi.fn(), onSuccess: vi.fn() })
    expect(result).toBeNull()
  })

  it('shows the selected count when members are selected', () => {
    seed(TAGS, [], false, null)
    const tree = renderTree(
      <MemberBulkTagBar selectedIds={['m1', 'm2']} onClear={vi.fn()} onSuccess={vi.fn()} />
    )
    expect(hasText(tree, 't:selectedCount:{"count":2}')).toBe(true)
  })
})

describe('MemberBulkTagBar button state', () => {
  beforeEach(() => vi.clearAllMocks())

  it('disables add/remove when no tags are chosen', () => {
    seed(TAGS, [], false, null)
    const tree = renderTree(
      <MemberBulkTagBar selectedIds={['m1']} onClear={vi.fn()} onSuccess={vi.fn()} />
    )
    const buttons = byType(tree, 'Button')
    const add = buttons.find((b) => (b.props as ButtonProps).children === 't:bulkAddTags')
    const remove = buttons.find((b) => (b.props as ButtonProps).children === 't:bulkRemoveTags')
    expect((add?.props as ButtonProps).disabled).toBe(true)
    expect((remove?.props as ButtonProps).disabled).toBe(true)
  })

  it('enables add/remove once tags are chosen and not busy', () => {
    seed(TAGS, ['t1'], false, null)
    const tree = renderTree(
      <MemberBulkTagBar selectedIds={['m1']} onClear={vi.fn()} onSuccess={vi.fn()} />
    )
    const buttons = byType(tree, 'Button')
    const add = buttons.find((b) => (b.props as ButtonProps).children === 't:bulkAddTags')
    expect((add?.props as ButtonProps).disabled).toBe(false)
  })

  it('disables add/remove while busy even with tags chosen', () => {
    seed(TAGS, ['t1'], true, null)
    const tree = renderTree(
      <MemberBulkTagBar selectedIds={['m1']} onClear={vi.fn()} onSuccess={vi.fn()} />
    )
    const buttons = byType(tree, 'Button')
    const add = buttons.find((b) => (b.props as ButtonProps).children === 't:bulkAddTags')
    expect((add?.props as ButtonProps).disabled).toBe(true)
  })
})

describe('MemberBulkTagBar clear', () => {
  it('fires onClear when the Clear button is clicked', () => {
    seed(TAGS, [], false, null)
    const onClear = vi.fn()
    const tree = renderTree(
      <MemberBulkTagBar selectedIds={['m1']} onClear={onClear} onSuccess={vi.fn()} />
    )
    const buttons = byType(tree, 'Button')
    const clear = buttons.find((b) => (b.props as ButtonProps).children === 't:clearSelection')
    ;(clear?.props as ButtonProps)?.onClick?.()
    expect(onClear).toHaveBeenCalledOnce()
  })
})

describe('MemberBulkTagBar submit — success', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls bulkUpdateMemberTags with the selection and action, then onSuccess', async () => {
    h.bulkUpdateMemberTags.mockResolvedValue({ ok: true, affected: 2 })
    seed(TAGS, ['t1', 't2'], false, null)
    const onSuccess = vi.fn()
    const tree = renderTree(
      <MemberBulkTagBar selectedIds={['m1', 'm2']} onClear={vi.fn()} onSuccess={onSuccess} />
    )
    const buttons = byType(tree, 'Button')
    const add = buttons.find((b) => (b.props as ButtonProps).children === 't:bulkAddTags')
    await (add?.props as ButtonProps).onClick?.()

    expect(h.bulkUpdateMemberTags).toHaveBeenCalledWith({
      memberIds: ['m1', 'm2'],
      tagIds: ['t1', 't2'],
      action: 'add',
    })
    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('issues a remove action from the Remove tags button', async () => {
    h.bulkUpdateMemberTags.mockResolvedValue({ ok: true, affected: 1 })
    seed(TAGS, ['t1'], false, null)
    const tree = renderTree(
      <MemberBulkTagBar selectedIds={['m1']} onClear={vi.fn()} onSuccess={vi.fn()} />
    )
    const buttons = byType(tree, 'Button')
    const remove = buttons.find((b) => (b.props as ButtonProps).children === 't:bulkRemoveTags')
    await (remove?.props as ButtonProps).onClick?.()

    expect(h.bulkUpdateMemberTags).toHaveBeenCalledWith({
      memberIds: ['m1'],
      tagIds: ['t1'],
      action: 'remove',
    })
  })

  it('renders the pre-seeded success status line with data-status="success"', () => {
    seed(TAGS, [], false, { variant: 'success', text: 't:bulkTagSuccess' })
    const tree = renderTree(
      <MemberBulkTagBar selectedIds={['m1']} onClear={vi.fn()} onSuccess={vi.fn()} />
    )
    const line = tree.find((el) => (el.props as { 'data-status'?: string })['data-status'] === 'success')
    expect(line).toBeDefined()
    expect(textOf(line as ReactElement)).toBe('t:bulkTagSuccess')
  })
})

describe('MemberBulkTagBar submit — failure', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not call onSuccess when the request is rejected as forbidden', async () => {
    h.bulkUpdateMemberTags.mockResolvedValue({ ok: false, errorKey: 'bulkTagForbidden' })
    seed(TAGS, ['t1'], false, null)
    const onSuccess = vi.fn()
    const tree = renderTree(
      <MemberBulkTagBar selectedIds={['m1']} onClear={vi.fn()} onSuccess={onSuccess} />
    )
    const buttons = byType(tree, 'Button')
    const add = buttons.find((b) => (b.props as ButtonProps).children === 't:bulkAddTags')
    await (add?.props as ButtonProps).onClick?.()

    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('renders the pre-seeded error status line with data-status="error"', () => {
    seed(TAGS, [], false, { variant: 'error', text: 't:bulkTagForbidden' })
    const tree = renderTree(
      <MemberBulkTagBar selectedIds={['m1']} onClear={vi.fn()} onSuccess={vi.fn()} />
    )
    const line = tree.find((el) => (el.props as { 'data-status'?: string })['data-status'] === 'error')
    expect(line).toBeDefined()
    expect(textOf(line as ReactElement)).toBe('t:bulkTagForbidden')
  })
})

describe('MemberBulkTagBar working state', () => {
  it('shows the working copy and hides the status line while busy', () => {
    seed(TAGS, ['t1'], true, { variant: 'success', text: 'stale' })
    const tree = renderTree(
      <MemberBulkTagBar selectedIds={['m1']} onClear={vi.fn()} onSuccess={vi.fn()} />
    )
    expect(hasText(tree, 't:bulkWorking')).toBe(true)
    expect(hasText(tree, 'stale')).toBe(false)
  })
})

// I-3 (2026-08-28 review): onSuccess clears selectedIds in the same batch as
// setStatus, so the bar must not unmount before the success line paints.
describe('MemberBulkTagBar success line survives selection clearing (I-3)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps rendering the success line once onSuccess has cleared the selection', async () => {
    h.bulkUpdateMemberTags.mockResolvedValue({ ok: true, affected: 2 })
    seed(TAGS, ['t1', 't2'], false, null)
    let selectedIds = ['m1', 'm2']
    const onSuccess = vi.fn(() => {
      selectedIds = []
    })
    const tree = renderTree(
      <MemberBulkTagBar selectedIds={selectedIds} onClear={vi.fn()} onSuccess={onSuccess} />
    )
    const buttons = byType(tree, 'Button')
    const add = buttons.find((b) => (b.props as ButtonProps).children === 't:bulkAddTags')
    await (add?.props as ButtonProps).onClick?.()

    // run() really drove onSuccess, which really cleared the selection.
    expect(onSuccess).toHaveBeenCalledOnce()
    expect(selectedIds).toEqual([])

    // The mocked useState setter is a no-op (see the harness note above), so
    // re-seed the queue with what the real setStatus(...) call inside run()
    // computed, and re-render with the now-cleared selection — this is the
    // exact next-render state the guard fix (`selectedIds.length === 0 &&
    // !status`) must keep visible instead of unmounting.
    seed(TAGS, [], false, {
      variant: 'success',
      text: 't:bulkTagSuccess:{"tags":"VIP, Lunch","count":2}',
    })
    const nextTree = renderTree(
      <MemberBulkTagBar selectedIds={selectedIds} onClear={vi.fn()} onSuccess={vi.fn()} />
    )
    const line = nextTree.find(
      (el) => (el.props as { 'data-status'?: string })['data-status'] === 'success'
    )
    expect(line).toBeDefined()
    expect(textOf(line as ReactElement)).toBe('t:bulkTagSuccess:{"tags":"VIP, Lunch","count":2}')
  })

  it('unmounts once the selection is empty and no status is pending', () => {
    seed(TAGS, [], false, null)
    const result = MemberBulkTagBar({ selectedIds: [], onClear: vi.fn(), onSuccess: vi.fn() })
    expect(result).toBeNull()
  })
})

// M-4: the tenant tag list must not be fetched on every members-page load —
// only once the bar actually has a selection to act on. Not exercised here:
// this harness stubs `useEffect` to a no-op (see the note above), so the
// fetch-gating `if (!hasSelection) return` inside the effect body never runs
// under either the old or new code — `h.fetchTags` is uncalled in every test
// in this file regardless. Verified by inspection instead.
