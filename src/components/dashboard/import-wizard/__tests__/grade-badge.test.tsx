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

import { GradeBadge } from '@/components/dashboard/import-wizard/grade-badge'

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

describe('GradeBadge', () => {
  it('renders with data-grade attribute', () => {
    const tree = renderTree(<GradeBadge grade="strong" />)
    const node = tree.find(
      (el) =>
        typeof el.props === 'object' &&
        (el.props as Record<string, unknown>)['data-grade'] === 'strong'
    )
    expect(node).toBeDefined()
  })

  it.each(['strong', 'medium', 'weak', 'none'] as const)(
    'renders %s grade with the right data-grade',
    (grade) => {
      const tree = renderTree(<GradeBadge grade={grade} />)
      const node = tree.find(
        (el) =>
          typeof el.props === 'object' &&
          (el.props as Record<string, unknown>)['data-grade'] === grade
      )
      expect(node).toBeDefined()
    }
  )
})
