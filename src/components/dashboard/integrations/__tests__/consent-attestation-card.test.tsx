import { describe, it, expect, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `t:${key}:${JSON.stringify(vars)}` : `t:${key}`,
}))

import {
  ConsentAttestationView,
  attestationGrade,
  type ConsentAttestationViewProps,
} from '@/components/dashboard/integrations/consent-attestation-card'
import { renderTree, byTestId, textOf } from './render-tree-test-utils'

// OD-13: text present + acknowledged -> strong; anything less -> weak.
describe('attestationGrade', () => {
  it('is strong when both text and ack are present', () => {
    expect(attestationGrade('Collected at checkout', true)).toBe('strong')
  })
  it('is weak when the text is empty even if acknowledged', () => {
    expect(attestationGrade('', true)).toBe('weak')
  })
  it('is weak when the text is whitespace-only', () => {
    expect(attestationGrade('   ', true)).toBe('weak')
  })
  it('is weak when not acknowledged even with text', () => {
    expect(attestationGrade('Collected at checkout', false)).toBe('weak')
  })
  it('is weak when both are absent', () => {
    expect(attestationGrade('', false)).toBe('weak')
  })
})

function baseProps(overrides: Partial<ConsentAttestationViewProps> = {}): ConsentAttestationViewProps {
  return {
    text: '',
    ack: false,
    onTextChange: vi.fn(),
    onAckChange: vi.fn(),
    saving: false,
    saved: false,
    errorCode: null,
    onSave: vi.fn(),
    ...overrides,
  }
}

describe('ConsentAttestationView', () => {
  it('shows the strong grade hint when text + ack are both present', () => {
    const tree = renderTree(<ConsentAttestationView {...baseProps({ text: 'Collected at checkout', ack: true })} />)
    expect(textOf(byTestId(tree, 'attestation-grade-hint'))).toBe('t:attestationGradeStrong')
  })

  it('shows the weak grade hint otherwise', () => {
    const tree = renderTree(<ConsentAttestationView {...baseProps({ text: '', ack: false })} />)
    expect(textOf(byTestId(tree, 'attestation-grade-hint'))).toBe('t:attestationGradeWeak')
  })

  it('fires onTextChange as the textarea changes', () => {
    const onTextChange = vi.fn()
    const tree = renderTree(<ConsentAttestationView {...baseProps({ onTextChange })} />)
    ;(byTestId(tree, 'attestation-text')!.props as { onChange: (e: unknown) => void }).onChange({
      target: { value: 'New text' },
    })
    expect(onTextChange).toHaveBeenCalledWith('New text')
  })

  it('fires onAckChange as the checkbox toggles', () => {
    const onAckChange = vi.fn()
    const tree = renderTree(<ConsentAttestationView {...baseProps({ onAckChange })} />)
    ;(byTestId(tree, 'attestation-ack')!.props as { onChange: (e: unknown) => void }).onChange({
      target: { checked: true },
    })
    expect(onAckChange).toHaveBeenCalledWith(true)
  })

  it('disables Save while saving', () => {
    const tree = renderTree(<ConsentAttestationView {...baseProps({ saving: true })} />)
    expect((byTestId(tree, 'attestation-save')!.props as { disabled: boolean }).disabled).toBe(true)
  })

  it('shows the saved indicator only when saved and there is no error', () => {
    const savedTree = renderTree(<ConsentAttestationView {...baseProps({ saved: true, errorCode: null })} />)
    expect(byTestId(savedTree, 'attestation-saved')).toBeDefined()

    const erroredTree = renderTree(
      <ConsentAttestationView {...baseProps({ saved: true, errorCode: 'invalid_consent_attestation_text' })} />
    )
    expect(byTestId(erroredTree, 'attestation-saved')).toBeUndefined()
  })

  it('renders the mapped error message', () => {
    const tree = renderTree(<ConsentAttestationView {...baseProps({ errorCode: 'network_error' })} />)
    expect(textOf(byTestId(tree, 'attestation-error'))).toBe('t:errorGeneric')
  })
})
