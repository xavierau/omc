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

import { BatchTagSelector } from '@/components/dashboard/import-wizard/batch-tag-selector'
import { TagCombobox } from '@/components/dashboard/tag-combobox'

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

describe('BatchTagSelector', () => {
  it('renders the tags label from importWizard.meta.tags', () => {
    const tree = renderTree(
      <BatchTagSelector selectedIds={[]} onChange={() => {}} />
    )
    const label = tree.find((el) => el.type === 'label')
    expect((label?.props as { children?: ReactNode }).children).toBe(
      't:meta.tags'
    )
  })

  it('renders the hint from importWizard.meta.tagsHint', () => {
    const tree = renderTree(
      <BatchTagSelector selectedIds={[]} onChange={() => {}} />
    )
    const hint = tree.find(
      (el) =>
        el.type === 'p' &&
        (el.props as { children?: ReactNode }).children === 't:meta.tagsHint'
    )
    expect(hint).toBeDefined()
  })

  it('mounts a multi-select TagCombobox wired to selectedIds', () => {
    const selectedIds = ['tag-1', 'tag-2']
    const tree = renderTree(
      <BatchTagSelector selectedIds={selectedIds} onChange={() => {}} />
    )
    const combobox = tree.find((el) => el.type === TagCombobox)
    expect(combobox).toBeDefined()
    const props = combobox?.props as {
      selectedIds: string[]
      multiple?: boolean
    }
    expect(props.selectedIds).toEqual(selectedIds)
    expect(props.multiple).toBe(true)
  })

  it('passes onChange straight through to the combobox', () => {
    const onChange = vi.fn()
    const tree = renderTree(
      <BatchTagSelector selectedIds={[]} onChange={onChange} />
    )
    const combobox = tree.find((el) => el.type === TagCombobox)
    const props = combobox?.props as { onChange: (ids: string[]) => void }
    props.onChange(['x'])
    expect(onChange).toHaveBeenCalledWith(['x'])
  })
})
