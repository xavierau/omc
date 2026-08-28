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

import { TagRow } from '@/components/dashboard/tag-row'
import type { Tag } from '@/domain/entities/tag'

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

function buttonWith(tree: ReactElement[], label: string): ReactElement | undefined {
  return tree.find(
    (el) =>
      typeof el.type === 'function' &&
      el.type.name === 'Button' &&
      (el.props as { children?: unknown }).children === label
  )
}

function hasText(tree: ReactElement[], text: string): boolean {
  return tree.some((el) => {
    const c = (el.props as { children?: unknown }).children
    return c === text
  })
}

const TAG: Tag = { id: 't-1', restaurantId: 'r-1', name: 'VIP', color: '#6B7280', createdAt: 'x' }

function row(overrides: Partial<Parameters<typeof TagRow>[0]> = {}) {
  return (
    <TagRow
      tag={TAG}
      mode="view"
      busy={false}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onConfirmDelete={vi.fn()}
      onCancel={vi.fn()}
      onRenamed={vi.fn()}
      {...overrides}
    />
  )
}

describe('TagRow', () => {
  it('renders the tag name and rename/delete actions in view mode', () => {
    const tree = renderTree(row())
    expect(hasText(tree, 'VIP')).toBe(true)
    expect(buttonWith(tree, 't:rename')).toBeDefined()
    expect(buttonWith(tree, 't:delete')).toBeDefined()
  })

  it('fires onEdit when rename is clicked', () => {
    const onEdit = vi.fn()
    const tree = renderTree(row({ onEdit }))
    ;(buttonWith(tree, 't:rename')?.props as { onClick: () => void }).onClick()
    expect(onEdit).toHaveBeenCalledOnce()
  })

  it('fires onDelete when delete is clicked in view mode', () => {
    const onDelete = vi.fn()
    const tree = renderTree(row({ onDelete }))
    ;(buttonWith(tree, 't:delete')?.props as { onClick: () => void }).onClick()
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('shows an inline confirm prompt (not a native dialog) in confirm mode', () => {
    const tree = renderTree(row({ mode: 'confirm' }))
    expect(hasText(tree, 't:deleteConfirm')).toBe(true)
    expect(buttonWith(tree, 't:delete')).toBeDefined()
    expect(buttonWith(tree, 't:cancel')).toBeDefined()
  })

  it('fires onConfirmDelete from the inline confirm, and onCancel from cancel', () => {
    const onConfirmDelete = vi.fn()
    const onCancel = vi.fn()
    const tree = renderTree(row({ mode: 'confirm', onConfirmDelete, onCancel }))
    ;(buttonWith(tree, 't:delete')?.props as { onClick: () => void }).onClick()
    ;(buttonWith(tree, 't:cancel')?.props as { onClick: () => void }).onClick()
    expect(onConfirmDelete).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
