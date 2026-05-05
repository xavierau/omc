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

import { ChecklistEditor } from '@/components/admin/onboarding/checklist-editor'
import { CHECKLIST_KEYS, type PreKickoffChecklist } from '@/domain/value-objects/pre-kickoff-checklist'

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
  const result = fn(element.props)
  return [...flatten(result)]
}

const allPending: PreKickoffChecklist = Object.freeze({
  hk_sim_never_used: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
  verified_meta_business: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
  display_name_draft_approved: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
  opt_in_source_documented: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
  vertical_allowed: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
  first_three_campaigns_drafted: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
})

const pathBChecklist: PreKickoffChecklist = Object.freeze({
  ...allPending,
  hk_sim_never_used: { checked: true, status: 'not_applicable', checkedAt: null, checkedBy: null },
})

describe('ChecklistEditor', () => {
  it('renders one row per checklist key', () => {
    const tree = renderTree(
      <ChecklistEditor checklist={allPending} onToggle={() => {}} />
    )
    const rows = tree.filter(
      (el) =>
        typeof el.props === 'object' &&
        (el.props as Record<string, unknown>)['data-checklist-row'] !== undefined
    )
    const keys = rows.map(
      (el) => (el.props as Record<string, unknown>)['data-checklist-row']
    )
    expect(keys).toEqual([...CHECKLIST_KEYS])
  })

  it('marks not_applicable rows as non-interactive', () => {
    const tree = renderTree(
      <ChecklistEditor checklist={pathBChecklist} onToggle={() => {}} />
    )
    const naRow = tree.find(
      (el) =>
        (el.props as Record<string, unknown>)['data-checklist-row'] ===
        'hk_sim_never_used'
    )
    expect((naRow?.props as Record<string, unknown>)['data-status']).toBe('not_applicable')
    const naCheckbox = tree.find(
      (el) =>
        el.type === 'input' &&
        (el.props as { name?: string }).name === 'hk_sim_never_used'
    )
    expect((naCheckbox?.props as { disabled?: boolean }).disabled).toBe(true)
  })

  it('keeps pending rows interactive', () => {
    const tree = renderTree(
      <ChecklistEditor checklist={allPending} onToggle={() => {}} />
    )
    const checkbox = tree.find(
      (el) =>
        el.type === 'input' &&
        (el.props as { name?: string }).name === 'verified_meta_business'
    )
    expect((checkbox?.props as { disabled?: boolean }).disabled).toBe(false)
  })

  it('invokes onToggle with the row key and the new checked value', () => {
    const onToggle = vi.fn()
    const tree = renderTree(
      <ChecklistEditor checklist={allPending} onToggle={onToggle} />
    )
    const checkbox = tree.find(
      (el) =>
        el.type === 'input' &&
        (el.props as { name?: string }).name === 'opt_in_source_documented'
    )
    const handler = (checkbox?.props as { onChange?: (e: unknown) => void }).onChange
    handler?.({ target: { checked: true } })
    expect(onToggle).toHaveBeenCalledWith('opt_in_source_documented', true)
  })
})
