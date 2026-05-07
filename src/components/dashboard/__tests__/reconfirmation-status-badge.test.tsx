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

import { ReconfirmationStatusBadge } from '@/components/dashboard/reconfirmation-status-badge'

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

function renderTree(element: ReactElement | null): ReactElement[] {
  if (element === null) return []
  const fn = element.type as (p: unknown) => ReactNode
  const result = fn(element.props)
  if (result === null) return []
  return [
    ...(isValidElement(result) ? [result] : []),
    ...flatten(result),
  ]
}

describe('ReconfirmationStatusBadge', () => {
  it('renders only when mode === "reconfirmation"', () => {
    const tree = renderTree(<ReconfirmationStatusBadge mode="reconfirmation" />)
    const badge = tree.find(
      (el) => (el.props as Record<string, unknown>)['data-mode'] === 'reconfirmation'
    )
    expect(badge).toBeDefined()
  })

  it('renders nothing when mode === "marketing"', () => {
    const tree = renderTree(<ReconfirmationStatusBadge mode="marketing" />)
    expect(tree).toHaveLength(0)
  })

  it('uses the campaignCardLabel i18n key', () => {
    const tree = renderTree(<ReconfirmationStatusBadge mode="reconfirmation" />)
    const allText: string[] = []
    for (const el of tree) {
      const children = (el.props as { children?: ReactNode }).children
      if (typeof children === 'string') allText.push(children)
    }
    expect(allText.some((t) => t.includes('campaignCardLabel'))).toBe(true)
  })

  it('exposes data-mode attribute for assertion', () => {
    const tree = renderTree(<ReconfirmationStatusBadge mode="reconfirmation" />)
    const modes = tree
      .map((el) => (el.props as Record<string, unknown>)['data-mode'])
      .filter((m) => m !== undefined)
    expect(modes).toContain('reconfirmation')
  })
})
