import { describe, it, expect, vi } from 'vitest'
import type { ReactElement } from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}))

import { MemberTagFilter } from '@/components/dashboard/member-tag-filter'
import { NO_TAG_FILTER } from '@/lib/constants'

type Props = Record<string, unknown>

function root(props: {
  tagId: string | null
  onChange: (id: string | null) => void
}): ReactElement[] {
  const el = MemberTagFilter(props) as ReactElement<{ children: ReactElement[] }>
  return el.props.children
}

function render(props: Parameters<typeof root>[0]): ReactElement {
  return root(props)[1]
}

function comboProps(el: ReactElement): Props {
  return el.props as Props
}

function chip(props: Parameters<typeof root>[0]): { badge: Props; button: Props } {
  const badge = comboProps(root(props)[0])
  const button = (badge.children as ReactElement).props as Props
  return { badge, button }
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

  it('emits NO_TAG_FILTER when the No tag chip is clicked', () => {
    const onChange = vi.fn()
    ;(chip({ tagId: null, onChange }).button.onClick as () => void)()
    expect(onChange).toHaveBeenCalledWith(NO_TAG_FILTER)
  })

  it('clears the filter when the active No tag chip is clicked again', () => {
    const onChange = vi.fn()
    ;(chip({ tagId: NO_TAG_FILTER, onChange }).button.onClick as () => void)()
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('with NO_TAG_FILTER the combobox selection is empty and the chip is pressed', () => {
    const props = { tagId: NO_TAG_FILTER, onChange: vi.fn() }
    expect(comboProps(render(props)).selectedIds).toEqual([])
    expect(chip(props).button['aria-pressed']).toBe(true)
  })

  it('emits the tag id when a real tag is picked while No tag is active', () => {
    const onChange = vi.fn()
    const el = render({ tagId: NO_TAG_FILTER, onChange })
    ;(comboProps(el).onChange as (ids: string[]) => void)(['t9'])
    expect(onChange).toHaveBeenCalledWith('t9')
  })
})
