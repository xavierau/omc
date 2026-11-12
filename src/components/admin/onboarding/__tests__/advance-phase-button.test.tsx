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

import { AdvancePhaseButton } from '@/components/admin/onboarding/advance-phase-button'

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

describe('AdvancePhaseButton', () => {
  it('renders an enabled button when canAdvance is true', () => {
    const tree = renderTree(
      <AdvancePhaseButton canAdvance={true} blockedReasons={[]} onAdvance={() => {}} />
    )
    const button = tree.find((el) => el.type === 'button')
    expect(button).toBeDefined()
    expect((button?.props as { disabled?: boolean }).disabled).toBeFalsy()
  })

  it('renders a disabled button when canAdvance is false', () => {
    const tree = renderTree(
      <AdvancePhaseButton
        canAdvance={false}
        blockedReasons={['kpi_failed']}
        onAdvance={() => {}}
      />
    )
    const button = tree.find((el) => el.type === 'button')
    expect((button?.props as { disabled?: boolean }).disabled).toBe(true)
  })

  it('emits one tooltip line per blocked reason', () => {
    const tree = renderTree(
      <AdvancePhaseButton
        canAdvance={false}
        blockedReasons={['checklist_incomplete', 'kpi_insufficient', 'no_path']}
        onAdvance={() => {}}
      />
    )
    const reasonNodes = tree.filter(
      (el) =>
        typeof el.props === 'object' &&
        (el.props as Record<string, unknown>)['data-reason'] !== undefined
    )
    const keys = reasonNodes.map(
      (el) => (el.props as Record<string, unknown>)['data-reason']
    )
    expect(keys).toEqual(['checklist_incomplete', 'kpi_insufficient', 'no_path'])
  })

  it('omits tooltip rows when there are no blocked reasons', () => {
    const tree = renderTree(
      <AdvancePhaseButton canAdvance={true} blockedReasons={[]} onAdvance={() => {}} />
    )
    const reasonNodes = tree.filter(
      (el) =>
        typeof el.props === 'object' &&
        (el.props as Record<string, unknown>)['data-reason'] !== undefined
    )
    expect(reasonNodes).toHaveLength(0)
  })

  it('wires onAdvance to the button onClick handler', () => {
    const onAdvance = vi.fn()
    const tree = renderTree(
      <AdvancePhaseButton canAdvance={true} blockedReasons={[]} onAdvance={onAdvance} />
    )
    const button = tree.find((el) => el.type === 'button')
    const handler = (button?.props as { onClick?: () => void }).onClick
    handler?.()
    expect(onAdvance).toHaveBeenCalledOnce()
  })
})
