import { describe, it, expect, vi } from 'vitest'
import type { ReactElement } from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}))

import { MemberTagFilter } from '@/components/dashboard/member-tag-filter'

function render(props: {
  tagId: string | null
  onChange: (id: string | null) => void
}): ReactElement {
  return MemberTagFilter(props) as ReactElement
}

function comboProps(el: ReactElement): Record<string, unknown> {
  return el.props as Record<string, unknown>
}

describe('MemberTagFilter', () => {
  it('renders a single-select combobox', () => {
    const el = render({ tagId: null, onChange: vi.fn() })
    expect(comboProps(el).multiple).toBe(false)
  })

  it('maps a tagId to selectedIds', () => {
    const el = render({ tagId: 't1', onChange: vi.fn() })
    expect(comboProps(el).selectedIds).toEqual(['t1'])
  })

  it('maps a null tagId to an empty selection', () => {
    const el = render({ tagId: null, onChange: vi.fn() })
    expect(comboProps(el).selectedIds).toEqual([])
  })

  it('emits the first selected id', () => {
    const onChange = vi.fn()
    const el = render({ tagId: null, onChange })
    ;(comboProps(el).onChange as (ids: string[]) => void)(['t2'])
    expect(onChange).toHaveBeenCalledWith('t2')
  })

  it('emits null when the selection is cleared', () => {
    const onChange = vi.fn()
    const el = render({ tagId: 't1', onChange })
    ;(comboProps(el).onChange as (ids: string[]) => void)([])
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
