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

import { StampCampaignCardView } from '@/components/dashboard/stamp-campaign-card-view'
import type { StampCampaign } from '@/hooks/use-stamp-campaigns'

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

function buttonLabels(tree: ReactElement[]): string[] {
  return tree
    .filter((el) => typeof el.type === 'function' && el.type.name === 'Button')
    .map((el) => {
      const c = (el.props as { children?: unknown }).children
      return typeof c === 'string' ? c : ''
    })
    .filter(Boolean)
}

function campaign(overrides: Partial<StampCampaign> = {}): StampCampaign {
  return {
    id: 'c-1',
    name: 'Coffee Card',
    nameZh: '咖啡卡',
    stampsRequired: 10,
    rewardId: 'rw-1',
    status: 'draft',
    maxStampsPerDay: 1,
    honorUntil: null,
    ...overrides,
  }
}

const view = (c: StampCampaign) => (
  <StampCampaignCardView campaign={c} busy={false} error={null} onRun={vi.fn()} onEnd={vi.fn()} />
)

describe('StampCampaignCardView', () => {
  it('shows Activate + End for a draft card', () => {
    const labels = buttonLabels(renderTree(view(campaign({ status: 'draft' }))))
    expect(labels).toContain('t:activate')
    expect(labels).toContain('t:end')
    expect(labels).not.toContain('t:pause')
  })

  it('shows Pause + End for an active card (no Activate)', () => {
    const labels = buttonLabels(renderTree(view(campaign({ status: 'active' }))))
    expect(labels).toContain('t:pause')
    expect(labels).toContain('t:end')
    expect(labels).not.toContain('t:activate')
  })

  it('shows Activate again for a paused card', () => {
    expect(buttonLabels(renderTree(view(campaign({ status: 'paused' }))))).toContain('t:activate')
  })

  it('shows no transition buttons for an ended card', () => {
    const labels = buttonLabels(renderTree(view(campaign({ status: 'ended' }))))
    expect(labels).not.toContain('t:activate')
    expect(labels).not.toContain('t:pause')
    expect(labels).not.toContain('t:end')
  })

  it('renders the honor-until note for an ended card', () => {
    const tree = renderTree(view(campaign({ status: 'ended', honorUntil: '2026-06-24T00:00:00Z' })))
    const note = tree.find((el) => {
      const c = (el.props as { children?: unknown }).children
      return typeof c === 'string' && c.startsWith('t:honorUntil')
    })
    expect(note).toBeDefined()
  })

  it('tags the card with its status for styling/testing', () => {
    const tree = renderTree(view(campaign({ status: 'active' })))
    const card = tree.find((el) => (el.props as Record<string, unknown>)['data-status'] === 'active')
    expect(card).toBeDefined()
  })

  it('fires onRun with the action when a transition button is clicked', () => {
    const onRun = vi.fn()
    const tree = renderTree(
      <StampCampaignCardView campaign={campaign({ status: 'draft' })} busy={false} error={null} onRun={onRun} onEnd={vi.fn()} />
    )
    const activate = tree.find(
      (el) => typeof el.type === 'function' && el.type.name === 'Button' && (el.props as { children?: unknown }).children === 't:activate'
    )
    ;(activate?.props as { onClick: () => void }).onClick()
    expect(onRun).toHaveBeenCalledWith('activate')
  })
})
