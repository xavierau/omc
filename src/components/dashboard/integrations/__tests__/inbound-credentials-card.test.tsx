import { describe, it, expect, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `t:${key}:${JSON.stringify(vars)}` : `t:${key}`,
}))

import {
  InboundCredentialsView,
  type InboundCredentialsViewProps,
} from '@/components/dashboard/integrations/inbound-credentials-card'
import { renderTree, byTestId, textOf } from './render-tree-test-utils'

function baseProps(overrides: Partial<InboundCredentialsViewProps> = {}): InboundCredentialsViewProps {
  return {
    webhookUrl: 'https://app.example.com/api/webhooks/pos/i-1',
    secretLast4: 'ab12',
    isAdmin: true,
    rotateState: 'idle',
    revealedSecret: null,
    rotateError: null,
    copiedField: null,
    onCopy: vi.fn(),
    onRequestRotate: vi.fn(),
    onCancelRotate: vi.fn(),
    onConfirmRotate: vi.fn(),
    onDismissReveal: vi.fn(),
    ...overrides,
  }
}

describe('InboundCredentialsView — admin-only rotate control', () => {
  it('shows the Rotate button for an admin', () => {
    const tree = renderTree(<InboundCredentialsView {...baseProps({ isAdmin: true })} />)
    expect(byTestId(tree, 'inbound-rotate-request')).toBeDefined()
  })

  it('hides the Rotate button entirely for staff', () => {
    const tree = renderTree(<InboundCredentialsView {...baseProps({ isAdmin: false })} />)
    expect(byTestId(tree, 'inbound-rotate-request')).toBeUndefined()
    expect(byTestId(tree, 'inbound-rotate-confirm')).toBeUndefined()
  })

  it('never shows the rotate confirm/reveal panels for staff even mid-flow', () => {
    const tree = renderTree(<InboundCredentialsView {...baseProps({ isAdmin: false, rotateState: 'confirming' })} />)
    expect(byTestId(tree, 'inbound-rotate-confirm')).toBeUndefined()
  })
})

describe('InboundCredentialsView — secret display', () => {
  it('shows the masked last4 when a secret exists', () => {
    const tree = renderTree(<InboundCredentialsView {...baseProps({ secretLast4: 'wxyz' })} />)
    expect(textOf(byTestId(tree, 'inbound-secret-last4'))).toContain('wxyz')
  })

  it('shows "not set" when there is no secret', () => {
    const tree = renderTree(<InboundCredentialsView {...baseProps({ secretLast4: null })} />)
    expect(textOf(byTestId(tree, 'inbound-secret-last4'))).toBe('t:secretNotSet')
  })

  it('renders the webhook URL read-only', () => {
    const tree = renderTree(<InboundCredentialsView {...baseProps()} />)
    const input = byTestId(tree, 'inbound-webhook-url')
    expect((input!.props as { value: string }).value).toBe('https://app.example.com/api/webhooks/pos/i-1')
    expect((input!.props as { readOnly: boolean }).readOnly).toBe(true)
  })
})

describe('InboundCredentialsView — rotate state machine (show-once)', () => {
  it('idle: only the request button is shown', () => {
    const tree = renderTree(<InboundCredentialsView {...baseProps({ rotateState: 'idle' })} />)
    expect(byTestId(tree, 'inbound-rotate-request')).toBeDefined()
    expect(byTestId(tree, 'inbound-rotate-confirm')).toBeUndefined()
    expect(byTestId(tree, 'inbound-secret-reveal')).toBeUndefined()
  })

  it('confirming: shows the warning + confirm/cancel, fires the right callbacks', () => {
    const onConfirmRotate = vi.fn()
    const onCancelRotate = vi.fn()
    const tree = renderTree(
      <InboundCredentialsView {...baseProps({ rotateState: 'confirming', onConfirmRotate, onCancelRotate })} />
    )
    expect(byTestId(tree, 'inbound-rotate-confirm')).toBeDefined()
    ;(byTestId(tree, 'inbound-rotate-confirm-button')!.props as { onClick: () => void }).onClick()
    expect(onConfirmRotate).toHaveBeenCalled()
  })

  it('rotating: shows a busy indicator, no confirm/reveal panel', () => {
    const tree = renderTree(<InboundCredentialsView {...baseProps({ rotateState: 'rotating' })} />)
    expect(byTestId(tree, 'inbound-rotating')).toBeDefined()
    expect(byTestId(tree, 'inbound-secret-reveal')).toBeUndefined()
  })

  it('revealed: shows the new secret exactly once with a "will not see again" notice', () => {
    const tree = renderTree(
      <InboundCredentialsView
        {...baseProps({ rotateState: 'revealed', revealedSecret: 'brand-new-secret-value' })}
      />
    )
    const reveal = byTestId(tree, 'inbound-secret-reveal')
    expect(reveal).toBeDefined()
    expect(textOf(reveal)).toContain('t:rotateRevealNotice')
    const secretInput = byTestId(tree, 'inbound-revealed-secret')
    expect((secretInput!.props as { value: string }).value).toBe('brand-new-secret-value')
  })

  it('revealed: Done fires onDismissReveal', () => {
    const onDismissReveal = vi.fn()
    const tree = renderTree(
      <InboundCredentialsView
        {...baseProps({ rotateState: 'revealed', revealedSecret: 'x', onDismissReveal })}
      />
    )
    ;(byTestId(tree, 'inbound-reveal-done')!.props as { onClick: () => void }).onClick()
    expect(onDismissReveal).toHaveBeenCalled()
  })

  it('renders a rotate error when present', () => {
    const tree = renderTree(<InboundCredentialsView {...baseProps({ rotateError: 'Failed to rotate secret' })} />)
    expect(textOf(byTestId(tree, 'inbound-rotate-error'))).toBe('Failed to rotate secret')
  })
})

describe('InboundCredentialsView — copy affordance', () => {
  it('shows "copy" then flips to "copied" per the copiedField flag', () => {
    const idle = renderTree(<InboundCredentialsView {...baseProps({ copiedField: null })} />)
    expect(textOf(byTestId(idle, 'inbound-copy-url'))).toBe('t:copyLink')

    const copied = renderTree(<InboundCredentialsView {...baseProps({ copiedField: 'webhookUrl' })} />)
    expect(textOf(byTestId(copied, 'inbound-copy-url'))).toBe('t:copied')
  })

  it('fires onCopy("webhookUrl") from the URL copy button', () => {
    const onCopy = vi.fn()
    const tree = renderTree(<InboundCredentialsView {...baseProps({ onCopy })} />)
    ;(byTestId(tree, 'inbound-copy-url')!.props as { onClick: () => void }).onClick()
    expect(onCopy).toHaveBeenCalledWith('webhookUrl')
  })
})
