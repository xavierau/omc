import { describe, it, expect, vi } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `t:${key}:${JSON.stringify(vars)}` : `t:${key}`,
}))

import { CampaignCardView, type CampaignCardViewProps } from '@/components/dashboard/campaign-card-view'

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

function byTestId(tree: ReactElement[], id: string): ReactElement | undefined {
  return tree.find((el) => (el.props as Record<string, unknown>)['data-testid'] === id)
}

function sendButton(tree: ReactElement[]): ReactElement | undefined {
  return tree.find(
    (el) =>
      typeof el.type === 'function' &&
      el.type.name === 'Button' &&
      ['t:sendNow', 't:sending'].includes((el.props as { children?: unknown }).children as string)
  )
}

function baseProps(overrides: Partial<CampaignCardViewProps> = {}): CampaignCardViewProps {
  return {
    name: 'Anniversary Sale',
    type: 'promo',
    status: 'active',
    sentCount: 10,
    redeemedCount: 2,
    scheduledAt: null,
    failureReason: null,
    templateReview: null,
    executing: false,
    executeError: null,
    sendDisabled: false,
    onExecute: () => {},
    onEdit: () => {},
    ...overrides,
  }
}

describe('CampaignCardView failed state', () => {
  it('shows the failure banner with the given reason', () => {
    const tree = renderTree(
      <CampaignCardView {...baseProps({ status: 'failed', failureReason: 'Template blocked' })} />
    )
    const banner = byTestId(tree, 'campaign-failed-banner')
    expect(banner).toBeDefined()
    expect(JSON.stringify((banner?.props as { children?: unknown }).children)).toContain('Template blocked')
  })

  it('falls back to a generic reason when none is given', () => {
    const tree = renderTree(<CampaignCardView {...baseProps({ status: 'failed', failureReason: null })} />)
    const banner = byTestId(tree, 'campaign-failed-banner')
    expect(JSON.stringify((banner?.props as { children?: unknown }).children)).toContain('t:failedReasonFallback')
  })

  it('shows no failure banner for a non-failed status', () => {
    const tree = renderTree(<CampaignCardView {...baseProps({ status: 'active' })} />)
    expect(byTestId(tree, 'campaign-failed-banner')).toBeUndefined()
  })
})

describe('CampaignCardView template-review gate', () => {
  it('disables send and shows the pending reason', () => {
    const tree = renderTree(
      <CampaignCardView {...baseProps({ templateReview: { required: true, status: 'pending' } })} />
    )
    const reason = byTestId(tree, 'campaign-gate-reason')
    expect(JSON.stringify((reason?.props as { children?: unknown }).children)).toContain('t:reviewRequiredPending')
    expect((sendButton(tree)?.props as { disabled?: boolean }).disabled).toBe(true)
  })

  it('disables send and shows the submit-for-review reason when not yet submitted', () => {
    const tree = renderTree(
      <CampaignCardView {...baseProps({ templateReview: { required: true, status: 'none' } })} />
    )
    const reason = byTestId(tree, 'campaign-gate-reason')
    expect(JSON.stringify((reason?.props as { children?: unknown }).children)).toContain('t:reviewRequiredSubmit')
    expect((sendButton(tree)?.props as { disabled?: boolean }).disabled).toBe(true)
  })

  it('does not block send when the template is approved', () => {
    const tree = renderTree(
      <CampaignCardView {...baseProps({ templateReview: { required: true, status: 'approved' } })} />
    )
    expect(byTestId(tree, 'campaign-gate-reason')).toBeUndefined()
    expect((sendButton(tree)?.props as { disabled?: boolean }).disabled).toBe(false)
  })

  it('does not block send when review is not required', () => {
    const tree = renderTree(
      <CampaignCardView {...baseProps({ templateReview: { required: false, status: 'none' } })} />
    )
    expect(byTestId(tree, 'campaign-gate-reason')).toBeUndefined()
  })
})

describe('CampaignCardView execute error', () => {
  it('renders the execute error message when present', () => {
    const tree = renderTree(<CampaignCardView {...baseProps({ executeError: 'Daily cap hit' })} />)
    const err = byTestId(tree, 'campaign-execute-error')
    expect(JSON.stringify((err?.props as { children?: unknown }).children)).toContain('Daily cap hit')
  })

  it('renders nothing when there is no execute error', () => {
    const tree = renderTree(<CampaignCardView {...baseProps({ executeError: null })} />)
    expect(byTestId(tree, 'campaign-execute-error')).toBeUndefined()
  })
})

describe('CampaignCardView send button availability', () => {
  it('hides the send button for welcome campaigns', () => {
    const tree = renderTree(<CampaignCardView {...baseProps({ type: 'welcome' })} />)
    expect(sendButton(tree)).toBeUndefined()
  })

  it('disables send when sendDisabled is set regardless of the gate', () => {
    const tree = renderTree(<CampaignCardView {...baseProps({ sendDisabled: true })} />)
    expect((sendButton(tree)?.props as { disabled?: boolean }).disabled).toBe(true)
  })
})
