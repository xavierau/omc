import { describe, it, expect, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `t:${key}:${JSON.stringify(vars)}` : `t:${key}`,
}))

import {
  OutboundWebhookView,
  canEnableOutbound,
  outboundStatusLabelKey,
  defaultOutboundEvents,
  type OutboundSettingsFormProps,
  type OutboundSecretFormProps,
  type OutboundTestEventProps,
} from '@/components/dashboard/integrations/outbound-webhook-card'
import { renderTree, byTestId, textOf } from './render-tree-test-utils'

// -- pure functions ---------------------------------------------------

// WI-1's frozen IntegrationSettings.fromProps invariant, mirrored
// client-side only to keep the checkbox from offering a combination the
// save would reject (spec §8.2: "stays Disabled with inline 'Acknowledge
// to enable'").
describe('canEnableOutbound', () => {
  it('requires a non-empty URL, a saved secret, and the PII ack — all three', () => {
    expect(canEnableOutbound('https://x.com', true, true)).toBe(true)
    expect(canEnableOutbound('', true, true)).toBe(false)
    expect(canEnableOutbound('   ', true, true)).toBe(false)
    expect(canEnableOutbound('https://x.com', false, true)).toBe(false)
    expect(canEnableOutbound('https://x.com', true, false)).toBe(false)
    expect(canEnableOutbound('', false, false)).toBe(false)
  })
})

describe('outboundStatusLabelKey', () => {
  it('maps every OutboundStatus to its own key', () => {
    expect(outboundStatusLabelKey('active')).toBe('statusActive')
    expect(outboundStatusLabelKey('paused_auto')).toBe('statusPausedAuto')
    expect(outboundStatusLabelKey('paused_manual')).toBe('statusPausedManual')
  })
})

describe('defaultOutboundEvents', () => {
  it('defaults an unconfigured integration to member.created only (spec §US-7)', () => {
    expect(defaultOutboundEvents([])).toEqual(['member.created'])
  })
  it('keeps whatever was already saved otherwise', () => {
    expect(defaultOutboundEvents(['member.updated'])).toEqual(['member.updated'])
    expect(defaultOutboundEvents(['member.created', 'member.updated'])).toEqual(['member.created', 'member.updated'])
  })
})

// -- pure view ----------------------------------------------------------

function formProps(overrides: Partial<OutboundSettingsFormProps> = {}): OutboundSettingsFormProps {
  return {
    url: '',
    onUrlChange: vi.fn(),
    events: ['member.created'],
    onToggleEvent: vi.fn(),
    piiAck: false,
    onPiiAckChange: vi.fn(),
    enabled: false,
    onEnabledChange: vi.fn(),
    canEnable: false,
    status: 'active',
    saving: false,
    saved: false,
    errorCode: null,
    onSave: vi.fn(),
    ...overrides,
  }
}

function secretProps(overrides: Partial<OutboundSecretFormProps> = {}): OutboundSecretFormProps {
  return {
    secretLast4: null,
    secretInput: '',
    onSecretInputChange: vi.fn(),
    state: 'idle',
    onSaveClick: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    error: null,
    saved: false,
    ...overrides,
  }
}

function testProps(overrides: Partial<OutboundTestEventProps> = {}): OutboundTestEventProps {
  return {
    state: 'idle',
    deliveryId: null,
    errorCode: null,
    onSend: vi.fn(),
    disabled: true,
    ...overrides,
  }
}

function view(
  form: Partial<OutboundSettingsFormProps> = {},
  secret: Partial<OutboundSecretFormProps> = {},
  test: Partial<OutboundTestEventProps> = {}
) {
  return renderTree(
    <OutboundWebhookView form={formProps(form)} secret={secretProps(secret)} test={testProps(test)} />
  )
}

describe('OutboundWebhookView — settings form', () => {
  it('fires onUrlChange as the URL input changes', () => {
    const onUrlChange = vi.fn()
    const tree = view({ onUrlChange })
    ;(byTestId(tree, 'outbound-url-input')!.props as { onChange: (e: unknown) => void }).onChange({
      target: { value: 'https://partner.example.com' },
    })
    expect(onUrlChange).toHaveBeenCalledWith('https://partner.example.com')
  })

  it('renders both event checkboxes, checked per the events prop', () => {
    const tree = view({ events: ['member.created'] })
    expect((byTestId(tree, 'outbound-event-member.created')!.props as { checked: boolean }).checked).toBe(true)
    expect((byTestId(tree, 'outbound-event-member.updated')!.props as { checked: boolean }).checked).toBe(false)
  })

  it('fires onToggleEvent with the event name and new checked state', () => {
    const onToggleEvent = vi.fn()
    const tree = view({ onToggleEvent })
    ;(byTestId(tree, 'outbound-event-member.updated')!.props as { onChange: (e: unknown) => void }).onChange({
      target: { checked: true },
    })
    expect(onToggleEvent).toHaveBeenCalledWith('member.updated', true)
  })

  it('shows the status badge text for the current outboundStatus', () => {
    const tree = view({ status: 'paused_auto' })
    expect(textOf(byTestId(tree, 'outbound-status-badge'))).toBe('t:statusPausedAuto')
  })

  // spec §8.2: "stays Disabled with inline 'Acknowledge to enable'"
  it('disables the Enabled checkbox and shows the prereq hint when canEnable is false', () => {
    const tree = view({ canEnable: false })
    expect((byTestId(tree, 'outbound-enabled')!.props as { disabled: boolean }).disabled).toBe(true)
    expect(byTestId(tree, 'outbound-enable-prereq-hint')).toBeDefined()
  })

  it('enables the Enabled checkbox and hides the hint when canEnable is true', () => {
    const tree = view({ canEnable: true })
    expect((byTestId(tree, 'outbound-enabled')!.props as { disabled: boolean }).disabled).toBe(false)
    expect(byTestId(tree, 'outbound-enable-prereq-hint')).toBeUndefined()
  })

  it('fires onSave from the Save button', () => {
    const onSave = vi.fn()
    const tree = view({ onSave })
    ;(byTestId(tree, 'outbound-save')!.props as { onClick: () => void }).onClick()
    expect(onSave).toHaveBeenCalled()
  })

  it('shows the saved indicator only when saved and there is no error', () => {
    expect(byTestId(view({ saved: true, errorCode: null }), 'outbound-saved')).toBeDefined()
    expect(byTestId(view({ saved: true, errorCode: 'url_invalid' }), 'outbound-saved')).toBeUndefined()
  })

  // every URL 422 code maps to its own inline copy (spec §8.2: "Must be
  // https" / "Private or local addresses are not allowed" / "Not a valid URL")
  it.each(['url_not_https', 'url_private_address', 'url_invalid', 'url_port', 'url_userinfo', 'pii_ack_required'])(
    'renders the mapped message for %s',
    (code) => {
      const tree = view({ errorCode: code })
      expect(byTestId(tree, 'outbound-save-error')).toBeDefined()
    }
  )
})

describe('OutboundWebhookView — secret (separate action from settings save, US-9/OD-9)', () => {
  it('shows "not set" then the masked last4 once saved', () => {
    expect(textOf(byTestId(view({}, { secretLast4: null }), 'outbound-secret-status'))).toBe('t:secretNotSet')
    expect(textOf(byTestId(view({}, { secretLast4: 'ab12' }), 'outbound-secret-status'))).toContain('ab12')
  })

  it('idle with no existing secret: Save button visible, no swap warning', () => {
    const tree = view({}, { state: 'idle', secretLast4: null })
    expect(byTestId(tree, 'outbound-secret-save')).toBeDefined()
    expect(byTestId(tree, 'outbound-secret-swap-warning')).toBeUndefined()
  })

  it('confirmingSwap: shows the warning + confirm/cancel', () => {
    const onConfirm = vi.fn()
    const tree = view({}, { state: 'confirmingSwap', onConfirm })
    const warning = byTestId(tree, 'outbound-secret-swap-warning')
    expect(warning).toBeDefined()
    expect(textOf(warning)).toContain('t:outboundSecretSwapWarning')
    ;(byTestId(tree, 'outbound-secret-confirm')!.props as { onClick: () => void }).onClick()
    expect(onConfirm).toHaveBeenCalled()
  })

  it('saving: shows a busy indicator, no Save/confirm buttons', () => {
    const tree = view({}, { state: 'saving' })
    expect(byTestId(tree, 'outbound-secret-saving')).toBeDefined()
    expect(byTestId(tree, 'outbound-secret-save')).toBeUndefined()
    expect(byTestId(tree, 'outbound-secret-swap-warning')).toBeUndefined()
  })

  it('shows the saved confirmation and the mapped error independently', () => {
    expect(byTestId(view({}, { saved: true }), 'outbound-secret-saved')).toBeDefined()
    expect(textOf(byTestId(view({}, { error: 'secret_too_short' }), 'outbound-secret-error'))).toBe(
      't:errorSecretTooShort'
    )
  })

  it('fires onSecretInputChange as the field changes', () => {
    const onSecretInputChange = vi.fn()
    const tree = view({}, { onSecretInputChange })
    ;(byTestId(tree, 'outbound-secret-input')!.props as { onChange: (e: unknown) => void }).onChange({
      target: { value: 'a'.repeat(20) },
    })
    expect(onSecretInputChange).toHaveBeenCalledWith('a'.repeat(20))
  })
})

describe('OutboundWebhookView — send test event', () => {
  it('is disabled until the caller says it is eligible', () => {
    expect((byTestId(view({}, {}, { disabled: true }), 'outbound-send-test')!.props as { disabled: boolean }).disabled).toBe(
      true
    )
    expect(
      (byTestId(view({}, {}, { disabled: false }), 'outbound-send-test')!.props as { disabled: boolean }).disabled
    ).toBe(false)
  })

  it('fires onSend when clicked', () => {
    const onSend = vi.fn()
    const tree = view({}, {}, { onSend, disabled: false })
    ;(byTestId(tree, 'outbound-send-test')!.props as { onClick: () => void }).onClick()
    expect(onSend).toHaveBeenCalled()
  })

  it('sent: shows the queued delivery id', () => {
    const tree = view({}, {}, { state: 'sent', deliveryId: 'd-123' })
    expect(textOf(byTestId(tree, 'outbound-test-sent'))).toContain('d-123')
  })

  it('error: url_not_saved and not_eligible_for_delivery both render their mapped message', () => {
    const urlTree = view({}, {}, { state: 'error', errorCode: 'url_not_saved' })
    expect(textOf(byTestId(urlTree, 'outbound-test-error'))).toBe('t:errorTestUrlNotSaved')

    const eligTree = view({}, {}, { state: 'error', errorCode: 'not_eligible_for_delivery' })
    expect(textOf(byTestId(eligTree, 'outbound-test-error'))).toBe('t:errorTestNotEligible')
  })

  // WI-10 extension point (this card never renders the live delivery row).
  it('always renders the WI-10 extension point mount node', () => {
    const tree = view()
    expect(byTestId(tree, 'outbound-test-extension-point')).toBeDefined()
  })
})
