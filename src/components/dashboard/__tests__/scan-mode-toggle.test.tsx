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

import { ScanModeToggle } from '@/components/dashboard/scan-mode-toggle'

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

function activeButton(tree: ReactElement[]): ReactElement | undefined {
  return tree.find(
    (el) =>
      el.type === 'button' &&
      (el.props as Record<string, unknown>)['data-active'] === true
  )
}

describe('ScanModeToggle', () => {
  it('marks Redeem active when mode is redeem', () => {
    const tree = renderTree(<ScanModeToggle mode="redeem" onChange={vi.fn()} />)
    const active = activeButton(tree)
    expect((active?.props as { children?: unknown }).children).toBe('t:modeRedeem')
  })

  it('marks Give Stamp active when mode is stamp', () => {
    const tree = renderTree(<ScanModeToggle mode="stamp" onChange={vi.fn()} />)
    const active = activeButton(tree)
    expect((active?.props as { children?: unknown }).children).toBe('t:modeStamp')
  })

  it('fires onChange with the clicked mode', () => {
    const onChange = vi.fn()
    const tree = renderTree(<ScanModeToggle mode="redeem" onChange={onChange} />)
    const stampButton = tree.find(
      (el) => el.type === 'button' && (el.props as { children?: unknown }).children === 't:modeStamp'
    )
    ;(stampButton?.props as { onClick: () => void }).onClick()
    expect(onChange).toHaveBeenCalledWith('stamp')
  })
})
