import { describe, it, expect, vi } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'

// Node-env tree-walk test (see campaign-member-picker-view.test.tsx). Both
// TagCombobox and CampaignTagRecipientCount call hooks internally, so they
// are stubbed out here — same treatment member-tags-section.test.tsx gives
// TagCombobox — to avoid invoking React's hook dispatcher outside of a
// real render. Their own props (as passed by CampaignTagPicker) are still
// captured in the tree, since `child.props` is fixed at creation time.

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/components/dashboard/tag-combobox', () => ({
  TagCombobox: () => null,
}))

vi.mock('@/components/dashboard/campaign-tag-recipient-count', () => ({
  CampaignTagRecipientCount: () => null,
}))

import { CampaignTagPicker } from '@/components/dashboard/campaign-tag-picker'

interface TagComboboxProps {
  selectedIds?: string[]
  onChange?: (ids: string[]) => void
  multiple?: boolean
  placeholder?: string
}

interface RecipientCountProps {
  tagIds?: string[]
}

interface TextProps {
  children?: unknown
  'data-field'?: string
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

function byName(tree: ReactElement[], name: string): ReactElement | undefined {
  return tree.find((el) => typeof el.type === 'function' && el.type.name === name)
}

describe('CampaignTagPicker — multi-select (regression against multiple={false})', () => {
  it('renders TagCombobox with multiple enabled', () => {
    const tree = renderTree(<CampaignTagPicker selectedIds={[]} onChange={() => {}} />)
    const combo = byName(tree, 'TagCombobox')
    expect((combo?.props as TagComboboxProps).multiple).toBe(true)
  })

  it('uses the plural "select tags" placeholder', () => {
    const tree = renderTree(<CampaignTagPicker selectedIds={[]} onChange={() => {}} />)
    const combo = byName(tree, 'TagCombobox')
    expect((combo?.props as TagComboboxProps).placeholder).toBe('selectTags')
  })

  it('forwards selectedIds and onChange through to TagCombobox unchanged', () => {
    const onChange = vi.fn()
    const tree = renderTree(
      <CampaignTagPicker selectedIds={['t-1', 't-2']} onChange={onChange} />
    )
    const combo = byName(tree, 'TagCombobox')
    const props = combo?.props as TagComboboxProps
    expect(props.selectedIds).toEqual(['t-1', 't-2'])
    expect(props.onChange).toBe(onChange)
  })
})

describe('CampaignTagPicker — OR hint (T-F3.2)', () => {
  it('renders the OR hint whenever the tag branch is shown', () => {
    const tree = renderTree(<CampaignTagPicker selectedIds={[]} onChange={() => {}} />)
    const hint = tree.find((el) => (el.props as TextProps)['data-field'] === 'tag-or-hint')
    expect(hint).toBeDefined()
    expect((hint?.props as TextProps).children).toBe('tagOrHint')
  })
})

describe('CampaignTagPicker — recipient count wiring', () => {
  it('passes the current selection through to CampaignTagRecipientCount', () => {
    const tree = renderTree(
      <CampaignTagPicker selectedIds={['t-1', 't-2']} onChange={() => {}} />
    )
    const recipientCount = byName(tree, 'CampaignTagRecipientCount')
    expect((recipientCount?.props as RecipientCountProps).tagIds).toEqual(['t-1', 't-2'])
  })
})
