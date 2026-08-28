import { describe, it, expect, vi } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const fn = (key: string, vars?: Record<string, unknown>) =>
      vars ? `t:${key}:${JSON.stringify(vars)}` : `t:${key}`
    return fn
  },
}))

import { MemberTable } from '@/components/dashboard/member-table'

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

function member(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    phone: '+85291234567',
    name: 'Wong',
    points_balance: 10,
    status: 'active',
    joined_at: '2026-01-01',
    last_visit_at: null,
    tags: [],
    ...overrides,
  }
}

const baseProps = {
  members: [member()],
  search: '',
  onSearchChange: vi.fn(),
  sortBy: 'name',
  sortOrder: 'asc' as const,
  onSort: vi.fn(),
  onSelectMember: vi.fn(),
  selectedIds: [] as string[],
  onToggle: vi.fn(),
  onToggleAll: vi.fn(),
}

describe('MemberTable row selection', () => {
  it('renders one RowSelectCell per member with the right checked state', () => {
    const tree = renderTree(
      <MemberTable {...baseProps} members={[member({ id: 'm-2' })]} selectedIds={['m-2']} />
    )
    const cells = byType(tree, 'RowSelectCell')
    expect(cells).toHaveLength(1)
    expect((cells[0].props as { checked: boolean }).checked).toBe(true)
    expect((cells[0].props as { memberId: string }).memberId).toBe('m-2')
  })

  it('forwards onToggle unchanged to each row cell', () => {
    const onToggle = vi.fn()
    const tree = renderTree(
      <MemberTable {...baseProps} members={[member({ id: 'm-9' })]} onToggle={onToggle} />
    )
    const cell = byType(tree, 'RowSelectCell')[0]
    expect((cell.props as { onToggle: unknown }).onToggle).toBe(onToggle)
  })
})

describe('MemberTable select-all-on-page', () => {
  it('marks the header allSelected when every rendered row is selected', () => {
    const tree = renderTree(
      <MemberTable
        {...baseProps}
        members={[member({ id: 'a' }), member({ id: 'b' })]}
        selectedIds={['a', 'b']}
      />
    )
    const header = byType(tree, 'SelectAllHeaderCell')[0]
    expect((header.props as { allSelected: boolean }).allSelected).toBe(true)
  })

  it('marks the header not-allSelected when only some rows are selected', () => {
    const tree = renderTree(
      <MemberTable
        {...baseProps}
        members={[member({ id: 'a' }), member({ id: 'b' })]}
        selectedIds={['a']}
      />
    )
    const header = byType(tree, 'SelectAllHeaderCell')[0]
    expect((header.props as { allSelected: boolean }).allSelected).toBe(false)
  })

  it('marks the header not-allSelected when there are no rows', () => {
    const tree = renderTree(<MemberTable {...baseProps} members={[]} selectedIds={[]} />)
    const header = byType(tree, 'SelectAllHeaderCell')[0]
    expect((header.props as { allSelected: boolean }).allSelected).toBe(false)
  })

  it('selects exactly the rendered rows when toggled on', () => {
    const onToggleAll = vi.fn()
    const tree = renderTree(
      <MemberTable
        {...baseProps}
        members={[member({ id: 'a' }), member({ id: 'b' })]}
        selectedIds={[]}
        onToggleAll={onToggleAll}
      />
    )
    const header = byType(tree, 'SelectAllHeaderCell')[0]
    ;(header.props as { onToggleAll: () => void }).onToggleAll()
    expect(onToggleAll).toHaveBeenCalledWith(['a', 'b'])
  })

  it('deselects all when toggled off', () => {
    const onToggleAll = vi.fn()
    const tree = renderTree(
      <MemberTable
        {...baseProps}
        members={[member({ id: 'a' }), member({ id: 'b' })]}
        selectedIds={['a', 'b']}
        onToggleAll={onToggleAll}
      />
    )
    const header = byType(tree, 'SelectAllHeaderCell')[0]
    ;(header.props as { onToggleAll: () => void }).onToggleAll()
    expect(onToggleAll).toHaveBeenCalledWith([])
  })
})
