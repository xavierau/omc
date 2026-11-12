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
import {
  deliveryFailureReason,
  deliveryUnknownReason,
} from '@/domain/services/campaign-delivery-failure-reason'
import enMessages from '@/messages/en.json'
import zhHkMessages from '@/messages/zh-HK.json'

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

describe('CampaignCardView re-run action (CAMP-014)', () => {
  const failed = { status: 'failed', failureReason: 'Meta said no', sentCount: 0 }

  it('a failed campaign offers re-run, and clicking only asks for confirmation', () => {
    const onRequestRerun = vi.fn()
    const tree = renderTree(<CampaignCardView {...baseProps({ ...failed, onRequestRerun })} />)
    const button = byTestId(tree, 'campaign-rerun-button')
    expect(button).toBeDefined()
    ;(button?.props as { onClick: () => void }).onClick()
    expect(onRequestRerun).toHaveBeenCalledTimes(1)
  })

  it('is hidden for a delivery-unknown failure: the send may already have gone out', () => {
    const tree = renderTree(
      <CampaignCardView {...baseProps({ ...failed, failureReason: deliveryUnknownReason(5, 2) })} />
    )
    expect(byTestId(tree, 'campaign-rerun-button')).toBeUndefined()
  })

  it('is hidden for a 131047 failure: the reason says to create a new campaign', () => {
    const tree = renderTree(
      <CampaignCardView {...baseProps({ ...failed, failureReason: deliveryFailureReason('131047', null, null) })} />
    )
    expect(byTestId(tree, 'campaign-rerun-button')).toBeUndefined()
  })

  it('is hidden for a welcome campaign', () => {
    const tree = renderTree(<CampaignCardView {...baseProps({ ...failed, type: 'welcome' })} />)
    expect(byTestId(tree, 'campaign-rerun-button')).toBeUndefined()
  })

  it.each(['draft', 'active', 'sending', 'paused', 'completed'])('is hidden for a %s campaign', (status) => {
    const tree = renderTree(<CampaignCardView {...baseProps({ status })} />)
    expect(byTestId(tree, 'campaign-rerun-button')).toBeUndefined()
  })

  it('shows a server rejection in the execute-error slot on a failed card', () => {
    const tree = renderTree(<CampaignCardView {...baseProps({ ...failed, executeError: 'Daily cap hit' })} />)
    const err = byTestId(tree, 'campaign-execute-error')
    expect(JSON.stringify((err?.props as { children?: unknown }).children)).toContain('Daily cap hit')
  })

  it('is disabled while running, under a guardrail block or a review gate', () => {
    const disabledFor = (o: Partial<CampaignCardViewProps>) => {
      const tree = renderTree(<CampaignCardView {...baseProps({ ...failed, ...o })} />)
      return (byTestId(tree, 'campaign-rerun-button')?.props as { disabled?: boolean }).disabled
    }
    expect(disabledFor({})).toBe(false)
    expect(disabledFor({ executing: true })).toBe(true)
    expect(disabledFor({ sendDisabled: true })).toBe(true)
    expect(disabledFor({ templateReview: { required: true, status: 'pending' } })).toBe(true)
  })

  it('a failed card offers re-run, not send now', () => {
    const tree = renderTree(<CampaignCardView {...baseProps(failed)} />)
    expect(sendButton(tree)).toBeUndefined()
  })
})

describe('CampaignCardView QR-only warning (CAMP-014)', () => {
  it.each(['active', 'failed'])('shows on a %s card', (status) => {
    const tree = renderTree(<CampaignCardView {...baseProps({ status, qrOnlyCoupon: true })} />)
    expect(byTestId(tree, 'campaign-qr-only-warning')).toBeDefined()
  })

  it('an active card can still change its template, so it keeps the change-it wording', () => {
    const tree = renderTree(<CampaignCardView {...baseProps({ status: 'active', qrOnlyCoupon: true })} />)
    const warning = byTestId(tree, 'campaign-qr-only-warning')
    expect((warning?.props as { children?: unknown }).children).toBe('t:qrOnlyWarning')
  })

  it('a failed card cannot change its template, so it words the remedy as a new campaign', () => {
    const tree = renderTree(<CampaignCardView {...baseProps({ status: 'failed', qrOnlyCoupon: true })} />)
    const warning = byTestId(tree, 'campaign-qr-only-warning')
    expect((warning?.props as { children?: unknown }).children).toBe('t:qrOnlyWarningFailed')
    for (const messages of [enMessages, zhHkMessages]) {
      expect(messages.campaigns.qrOnlyWarningFailed).toBeTruthy()
    }
    expect(enMessages.campaigns.qrOnlyWarningFailed).toContain('create a new campaign')
    expect(zhHkMessages.campaigns.qrOnlyWarningFailed).toContain('建立新推廣')
  })

  it('sits above the re-run action', () => {
    const tree = renderTree(
      <CampaignCardView {...baseProps({ status: 'failed', failureReason: 'x', qrOnlyCoupon: true })} />
    )
    const warning = tree.indexOf(byTestId(tree, 'campaign-qr-only-warning') as ReactElement)
    const action = tree.indexOf(byTestId(tree, 'campaign-rerun-button') as ReactElement)
    expect(warning).toBeGreaterThanOrEqual(0)
    expect(warning).toBeLessThan(action)
  })

  it.each(['draft', 'paused', 'completed', 'sending'])('does not show on a %s card', (status) => {
    const tree = renderTree(<CampaignCardView {...baseProps({ status, qrOnlyCoupon: true })} />)
    expect(byTestId(tree, 'campaign-qr-only-warning')).toBeUndefined()
  })

  it('does not show without the flag', () => {
    const tree = renderTree(<CampaignCardView {...baseProps({ status: 'active' })} />)
    expect(byTestId(tree, 'campaign-qr-only-warning')).toBeUndefined()
  })
})

describe('CampaignCardView QR failure warning (CAMP-014)', () => {
  it('shows the count when QR images failed and sends are counted', () => {
    const tree = renderTree(
      <CampaignCardView {...baseProps({ status: 'completed', sentCount: 10, qrFailedCount: 3 })} />
    )
    const warning = byTestId(tree, 'campaign-qr-failed-warning')
    expect((warning?.props as { children?: unknown }).children).toBe('t:qrFailedWarning:{"count":3}')
  })

  // A storage outage writes the same rows as a Meta rejection, so the wording
  // must not claim which system decided.
  it('names no deciding system, in either language', () => {
    expect(enMessages.campaigns.qrFailedWarning).toContain('could not be delivered')
    expect(enMessages.campaigns.qrFailedWarning).toContain('did not receive their code')
    for (const messages of [enMessages, zhHkMessages]) {
      expect(messages.campaigns.qrFailedWarning).not.toMatch(/meta|whatsapp/i)
    }
  })

  it('stays quiet on an all-failed campaign: the reason already explains it', () => {
    const tree = renderTree(
      <CampaignCardView {...baseProps({ status: 'failed', sentCount: 0, qrFailedCount: 250 })} />
    )
    expect(byTestId(tree, 'campaign-qr-failed-warning')).toBeUndefined()
  })

  it.each([[0], [undefined]])('stays quiet with a count of %s', (qrFailedCount) => {
    const tree = renderTree(
      <CampaignCardView {...baseProps({ status: 'completed', sentCount: 10, qrFailedCount })} />
    )
    expect(byTestId(tree, 'campaign-qr-failed-warning')).toBeUndefined()
  })
})
