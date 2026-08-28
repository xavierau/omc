import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

// This project runs vitest in a node env (no DOM/RTL), so component tests call
// the component function directly and walk the returned tree. MemberTagsSection
// is stateful, so useState is mocked (call order: tags, pendingIds, busy) and
// TagCombobox (its own hooks) plus the request helpers are stubbed out.
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
    assignMemberTags: vi.fn(),
    removeMemberTag: vi.fn(),
    fetchMemberTags: vi.fn(),
  }
})

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useState: h.useState as unknown as typeof actual.useState }
})

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/components/dashboard/tag-combobox', () => ({
  TagCombobox: () => null,
}))

vi.mock('@/components/dashboard/member-tags-section-helpers', () => ({
  assignMemberTags: h.assignMemberTags,
  removeMemberTag: h.removeMemberTag,
  fetchMemberTags: h.fetchMemberTags,
}))

import { MemberTagsSection } from '@/components/dashboard/member-tags-section'

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

const VIP = { id: 't-vip', name: 'VIP', color: '#6B7280' }

function render(onChanged: () => void): ReactElement[] {
  // Order matches the component's useState calls: tags, pendingIds, busy.
  h.state.queue = [[VIP], ['tp-1'], false]
  h.state.idx = 0
  return renderTree(<MemberTagsSection memberId="m1" tags={[VIP]} onChanged={onChanged} />)
}

function byName(tree: ReactElement[], name: string): ReactElement | undefined {
  return tree.find((el) => typeof el.type === 'function' && el.type.name === name)
}

describe('MemberTagsSection onChanged', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.assignMemberTags.mockResolvedValue(undefined)
    h.removeMemberTag.mockResolvedValue(undefined)
    h.fetchMemberTags.mockResolvedValue([])
  })

  it('invokes onChanged after a successful add', async () => {
    const onChanged = vi.fn()
    const tree = render(onChanged)
    const addButton = tree.find(
      (el) =>
        typeof el.type === 'function' &&
        el.type.name === 'Button' &&
        (el.props as { children?: unknown }).children === 'addTag'
    )
    await (addButton?.props as { onClick: () => Promise<void> }).onClick()
    expect(h.assignMemberTags).toHaveBeenCalledOnce()
    expect(onChanged).toHaveBeenCalledOnce()
  })

  it('invokes onChanged after a successful remove', async () => {
    const onChanged = vi.fn()
    const tree = render(onChanged)
    const chip = byName(tree, 'RemovableTagChip')
    const chipProps = chip?.props as { onRemove: (id: string) => Promise<void>; tag: { id: string } }
    await chipProps.onRemove(chipProps.tag.id)
    expect(h.removeMemberTag).toHaveBeenCalledWith('m1', 't-vip')
    expect(onChanged).toHaveBeenCalledOnce()
  })

  it('does not invoke onChanged when a remove fails', async () => {
    h.removeMemberTag.mockRejectedValueOnce(new Error('boom'))
    const onChanged = vi.fn()
    const tree = render(onChanged)
    const chip = byName(tree, 'RemovableTagChip')
    const chipProps = chip?.props as { onRemove: (id: string) => Promise<void>; tag: { id: string } }
    await chipProps.onRemove(chipProps.tag.id)
    expect(onChanged).not.toHaveBeenCalled()
  })
})
