import { describe, it, expect, vi } from 'vitest'
import type { ReactElement } from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}))

import { SelectAllHeaderCell, RowSelectCell } from '@/components/dashboard/member-table-select-cell'

function checkboxProps(el: ReactElement): Record<string, unknown> {
  const inputEl = (el.props as { children: ReactElement }).children
  return inputEl.props as Record<string, unknown>
}

describe('SelectAllHeaderCell', () => {
  it('labels the checkbox with the select-all-on-page copy', () => {
    const el = SelectAllHeaderCell({ allSelected: false, onToggleAll: vi.fn() })
    expect(checkboxProps(el)['aria-label']).toBe('t:selectAllOnPage')
  })

  it('reflects allSelected as the checked state', () => {
    const el = SelectAllHeaderCell({ allSelected: true, onToggleAll: vi.fn() })
    expect(checkboxProps(el).checked).toBe(true)
  })

  it('fires onToggleAll on change', () => {
    const onToggleAll = vi.fn()
    const el = SelectAllHeaderCell({ allSelected: false, onToggleAll })
    ;(checkboxProps(el).onChange as () => void)()
    expect(onToggleAll).toHaveBeenCalledOnce()
  })
})

describe('RowSelectCell', () => {
  it('reflects the checked prop', () => {
    const el = RowSelectCell({ memberId: 'm1', checked: true, onToggle: vi.fn() })
    expect(checkboxProps(el).checked).toBe(true)
  })

  it('fires onToggle with the member id on change', () => {
    const onToggle = vi.fn()
    const el = RowSelectCell({ memberId: 'm-9', checked: false, onToggle })
    ;(checkboxProps(el).onChange as () => void)()
    expect(onToggle).toHaveBeenCalledWith('m-9')
  })

  it('stops the click from propagating to the row', () => {
    const el = RowSelectCell({ memberId: 'm1', checked: false, onToggle: vi.fn() })
    const stopPropagation = vi.fn()
    ;(checkboxProps(el).onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation })
    expect(stopPropagation).toHaveBeenCalledOnce()
  })
})
