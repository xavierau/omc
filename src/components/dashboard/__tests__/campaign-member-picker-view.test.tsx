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

import { CampaignMemberPickerView } from '@/components/dashboard/campaign-member-picker-view'
import type { PickerMember } from '@/hooks/campaign-member-picker-client'

interface MemberRowProps {
  member: PickerMember
  checked: boolean
  onToggle: (id: string) => void
  unknownLabel: string
}

interface CheckboxProps {
  type?: string
  checked?: boolean
  onChange?: () => void
}

interface ButtonProps {
  children?: unknown
  disabled?: boolean
  onClick?: () => void
}

interface TextProps {
  children?: unknown
}

interface SearchInputProps {
  value?: string
  onChange?: (e: { target: { value: string } }) => void
}

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
  return (el.props as TextProps).children
}

function hasText(tree: ReactElement[], text: string): boolean {
  return tree.some((el) => textOf(el) === text)
}

function member(overrides: Partial<PickerMember> = {}): PickerMember {
  return { id: 'm-1', name: 'Wong', phone: '+85291234567', ...overrides }
}

const baseProps = {
  members: [member()],
  total: 1,
  loading: false,
  loadingMore: false,
  hasMore: false,
  error: false,
  search: '',
  selectedIds: [] as string[],
  onSearchChange: vi.fn(),
  onToggle: vi.fn(),
  onSelectAll: vi.fn(),
  onDeselectAll: vi.fn(),
  onLoadMore: vi.fn(),
}

describe('CampaignMemberPickerView loading', () => {
  it('shows only the loading indicator while loading', () => {
    const tree = renderTree(<CampaignMemberPickerView {...baseProps} loading />)
    expect(hasText(tree, 't:loading')).toBe(true)
    expect(byType(tree, 'MemberRow')).toHaveLength(0)
  })
})

describe('CampaignMemberPickerView member rows', () => {
  it('renders a row per loaded member with name and phone', () => {
    const tree = renderTree(
      <CampaignMemberPickerView
        {...baseProps}
        members={[member({ id: 'm-1', name: 'Wong', phone: '+85291234567' })]}
      />
    )
    const rows = byType(tree, 'MemberRow')
    expect(rows).toHaveLength(1)
    expect((rows[0].props as MemberRowProps).member).toEqual(member())
  })

  it('falls back to the unknown label when name is null', () => {
    const tree = renderTree(
      <CampaignMemberPickerView {...baseProps} members={[member({ name: null })]} />
    )
    const rows = byType(tree, 'MemberRow')
    expect((rows[0].props as MemberRowProps).unknownLabel).toBe('t:unknown')
  })

  it('marks a row checked when its id is selected', () => {
    const tree = renderTree(
      <CampaignMemberPickerView {...baseProps} members={[member({ id: 'm-2' })]} selectedIds={['m-2']} />
    )
    expect((byType(tree, 'MemberRow')[0].props as MemberRowProps).checked).toBe(true)
  })

  it('fires onToggle with the row id when its checkbox changes', () => {
    const onToggle = vi.fn()
    const tree = renderTree(
      <CampaignMemberPickerView {...baseProps} members={[member({ id: 'm-3' })]} onToggle={onToggle} />
    )
    const checkbox = tree.find((el) => el.type === 'input' && (el.props as CheckboxProps).type === 'checkbox')
    ;(checkbox?.props as CheckboxProps)?.onChange?.()
    expect(onToggle).toHaveBeenCalledWith('m-3')
  })

  it('shows the no-match empty state when no members are loaded', () => {
    const tree = renderTree(<CampaignMemberPickerView {...baseProps} members={[]} total={0} />)
    expect(hasText(tree, 't:noMatch')).toBe(true)
  })
})

describe('CampaignMemberPickerView error state', () => {
  it('shows a load-error message instead of the empty-search noMatch text', () => {
    const tree = renderTree(<CampaignMemberPickerView {...baseProps} members={[]} total={0} error />)
    expect(hasText(tree, 't:loadError')).toBe(true)
    expect(hasText(tree, 't:noMatch')).toBe(false)
  })

  it('does not show the error message when the load succeeded', () => {
    const tree = renderTree(<CampaignMemberPickerView {...baseProps} members={[]} total={0} error={false} />)
    expect(hasText(tree, 't:noMatch')).toBe(true)
    expect(hasText(tree, 't:loadError')).toBe(false)
  })

  it('surfaces a load-more failure without hiding the already-loaded rows', () => {
    const tree = renderTree(
      <CampaignMemberPickerView {...baseProps} members={[member(), member({ id: 'm-2' })]} error hasMore />
    )
    expect(hasText(tree, 't:loadError')).toBe(true)
    expect(byType(tree, 'MemberRow')).toHaveLength(2)
  })
})

describe('CampaignMemberPickerView select all honesty', () => {
  it('labels plain "Select all" when the full result set is loaded', () => {
    const tree = renderTree(<CampaignMemberPickerView {...baseProps} hasMore={false} />)
    const buttons = byType(tree, 'Button')
    expect(buttons.some((b) => (b.props as ButtonProps).children === 't:selectAll')).toBe(true)
  })

  it('labels "Select all N loaded" honestly when more pages remain', () => {
    const tree = renderTree(
      <CampaignMemberPickerView {...baseProps} members={[member(), member({ id: 'm-2' })]} hasMore />
    )
    const buttons = byType(tree, 'Button')
    expect(
      buttons.some((b) => (b.props as ButtonProps).children === 't:selectAllLoaded:{"count":2}')
    ).toBe(true)
  })

  it('calls onSelectAll when the select-all button is clicked', () => {
    const onSelectAll = vi.fn()
    const tree = renderTree(<CampaignMemberPickerView {...baseProps} onSelectAll={onSelectAll} />)
    const buttons = byType(tree, 'Button')
    const selectAllBtn = buttons.find((b) => (b.props as ButtonProps).children === 't:selectAll')
    ;(selectAllBtn?.props as ButtonProps)?.onClick?.()
    expect(onSelectAll).toHaveBeenCalled()
  })

  it('calls onDeselectAll when the deselect-all button is clicked', () => {
    const onDeselectAll = vi.fn()
    const tree = renderTree(<CampaignMemberPickerView {...baseProps} onDeselectAll={onDeselectAll} />)
    const buttons = byType(tree, 'Button')
    const btn = buttons.find((b) => (b.props as ButtonProps).children === 't:deselectAll')
    ;(btn?.props as ButtonProps)?.onClick?.()
    expect(onDeselectAll).toHaveBeenCalled()
  })
})

describe('CampaignMemberPickerView result count', () => {
  it('shows "showing" text when members are loaded', () => {
    const tree = renderTree(
      <CampaignMemberPickerView {...baseProps} members={[member()]} total={43} />
    )
    expect(hasText(tree, 't:showing:{"start":1,"end":1,"total":43}')).toBe(true)
  })

  it('omits the count line when nothing is loaded', () => {
    const tree = renderTree(<CampaignMemberPickerView {...baseProps} members={[]} total={0} />)
    const hasShowing = tree.some((el) => {
      const c = textOf(el)
      return typeof c === 'string' && c.startsWith('t:showing')
    })
    expect(hasShowing).toBe(false)
  })
})

describe('CampaignMemberPickerView load more', () => {
  it('shows a Load more button when hasMore is true', () => {
    const tree = renderTree(<CampaignMemberPickerView {...baseProps} hasMore />)
    const buttons = byType(tree, 'Button')
    expect(buttons.some((b) => (b.props as ButtonProps).children === 't:loadMore')).toBe(true)
  })

  it('hides the Load more button when hasMore is false', () => {
    const tree = renderTree(<CampaignMemberPickerView {...baseProps} hasMore={false} />)
    const buttons = byType(tree, 'Button')
    expect(buttons.some((b) => (b.props as ButtonProps).children === 't:loadMore')).toBe(false)
  })

  it('shows loading text and disables the button while loading more', () => {
    const tree = renderTree(<CampaignMemberPickerView {...baseProps} hasMore loadingMore />)
    const buttons = byType(tree, 'Button')
    const loadMoreBtn = buttons.find((b) => (b.props as ButtonProps).children === 't:loading')
    expect(loadMoreBtn).toBeDefined()
    expect((loadMoreBtn?.props as ButtonProps).disabled).toBe(true)
  })

  it('fires onLoadMore when clicked', () => {
    const onLoadMore = vi.fn()
    const tree = renderTree(<CampaignMemberPickerView {...baseProps} hasMore onLoadMore={onLoadMore} />)
    const buttons = byType(tree, 'Button')
    const loadMoreBtn = buttons.find((b) => (b.props as ButtonProps).children === 't:loadMore')
    ;(loadMoreBtn?.props as ButtonProps)?.onClick?.()
    expect(onLoadMore).toHaveBeenCalled()
  })
})

describe('CampaignMemberPickerView search input', () => {
  it('wires the search value and change handler', () => {
    const onSearchChange = vi.fn()
    const tree = renderTree(
      <CampaignMemberPickerView {...baseProps} search="won" onSearchChange={onSearchChange} />
    )
    const input = tree.find(
      (el) => typeof el.type === 'function' && el.type.name === 'Input'
    )
    const inputProps = input?.props as SearchInputProps
    expect(inputProps.value).toBe('won')
    inputProps.onChange?.({ target: { value: 'wong' } })
    expect(onSearchChange).toHaveBeenCalledWith('wong')
  })
})
