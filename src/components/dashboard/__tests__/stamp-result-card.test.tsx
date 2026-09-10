import { describe, it, expect, vi } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const fn = (key: string, vars?: Record<string, unknown>) =>
      vars ? `t:${key}:${JSON.stringify(vars)}` : `t:${key}`
    return fn
  },
}))

import { StampResultCard } from '@/components/dashboard/stamp-result-card'
import type { StampOutcome } from '@/hooks/use-give-stamp'

// Deep shallow-render: flattens host elements AND invokes nested function components
// (the StampResultCard delegates outcome rendering to small sub-components). The
// StampPhoneLookup leaf is intentionally NOT expanded (it carries its own useState)
// so the not_resolved test asserts it is mounted rather than its internals.
const DO_NOT_EXPAND = new Set(['StampPhoneLookup'])

function flatten(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = []
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return
    out.push(child)
    if (typeof child.type === 'function' && !DO_NOT_EXPAND.has(child.type.name)) {
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

function findByOutcome(tree: ReactElement[], outcome: string): ReactElement | undefined {
  return tree.find(
    (el) =>
      typeof el.props === 'object' &&
      (el.props as Record<string, unknown>)['data-outcome'] === outcome
  )
}

function textOf(tree: ReactElement[]): string {
  return tree
    .map((el) => {
      const c = (el.props as { children?: unknown }).children
      return typeof c === 'string' ? c : ''
    })
    .join(' ')
}

const baseProps = {
  loading: false,
  lookupLoading: false,
  lookupNotFound: false,
  onGiveAnother: vi.fn(),
  onLookupByPhone: vi.fn(),
  onAddMember: vi.fn(),
}

function makeResult(outcome: StampOutcome, count: number, required: number, completed = false) {
  return { outcome, stampsCount: count, stampsRequired: required, completed }
}

describe('StampResultCard', () => {
  it('renders the confirm screen when there is no result yet', () => {
    const tree = renderTree(
      <StampResultCard {...baseProps} result={null} onConfirm={vi.fn()} />
    )
    expect(findByOutcome(tree, 'confirm')).toBeDefined()
  })

  it('renders the stamped outcome with progress and remaining', () => {
    const tree = renderTree(
      <StampResultCard {...baseProps} result={makeResult('stamped', 7, 10)} onConfirm={vi.fn()} />
    )
    expect(findByOutcome(tree, 'stamped')).toBeDefined()
    const text = textOf(tree)
    expect(text).toContain('t:stampAdded')
    expect(text).toContain('"count":7')
    expect(text).toContain('"remaining":3')
  })

  it('renders already_stamped_today with the unchanged count', () => {
    const tree = renderTree(
      <StampResultCard {...baseProps} result={makeResult('already_stamped_today', 7, 10)} onConfirm={vi.fn()} />
    )
    expect(findByOutcome(tree, 'already_stamped_today')).toBeDefined()
    expect(textOf(tree)).toContain('t:stampAlreadyToday')
  })

  it('renders the completed outcome (reward unlocked, reset to 0)', () => {
    const tree = renderTree(
      <StampResultCard {...baseProps} result={makeResult('completed', 0, 10, true)} onConfirm={vi.fn()} />
    )
    expect(findByOutcome(tree, 'completed')).toBeDefined()
    expect(textOf(tree)).toContain('t:stampCompleted')
  })

  it('renders no_active_campaign', () => {
    const tree = renderTree(
      <StampResultCard {...baseProps} result={makeResult('no_active_campaign', 0, 0)} onConfirm={vi.fn()} />
    )
    expect(findByOutcome(tree, 'no_active_campaign')).toBeDefined()
    expect(textOf(tree)).toContain('t:stampNoCampaign')
  })

  it('renders not_resolved with a phone-lookup affordance', () => {
    const tree = renderTree(
      <StampResultCard {...baseProps} result={makeResult('not_resolved', 0, 0)} onConfirm={vi.fn()} />
    )
    expect(findByOutcome(tree, 'not_resolved')).toBeDefined()
    expect(textOf(tree)).toContain('t:stampNotResolved')
    // The phone-lookup affordance is mounted as a child component element.
    const lookup = tree.find((el) => typeof el.type === 'function' && el.type.name === 'StampPhoneLookup')
    expect(lookup).toBeDefined()
  })
})
