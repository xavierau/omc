import { describe, it, expect, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `t:${key}:${JSON.stringify(vars)}` : `t:${key}`,
}))

import {
  WelcomeTemplateView,
  welcomeHelperState,
  initialWelcomeChoice,
  isLockedSpecific,
  type WelcomeTemplateViewProps,
} from '@/components/dashboard/integrations/welcome-template-card'
import { renderTree, byTestId, textOf } from './render-tree-test-utils'

// -- pure functions (spec §5.2 D3 / US-8) --------------------------------

describe('initialWelcomeChoice', () => {
  it('null -> off (OD-3 default)', () => expect(initialWelcomeChoice(null)).toBe('off'))
  it("'default' -> default", () => expect(initialWelcomeChoice('default')).toBe('default'))
  it('a specific uuid -> off (the launch UI never shows it as selected)', () =>
    expect(initialWelcomeChoice('11111111-1111-1111-1111-111111111111')).toBe('off'))
})

describe('isLockedSpecific', () => {
  it('is false for null', () => expect(isLockedSpecific(null)).toBe(false))
  it("is false for 'default'", () => expect(isLockedSpecific('default')).toBe(false))
  it('is true for a specific template id (US-4 model+API launch, dashboard post-launch)', () =>
    expect(isLockedSpecific('11111111-1111-1111-1111-111111111111')).toBe(true))
})

describe('welcomeHelperState', () => {
  it('off choice -> off, regardless of resolvedTemplate', () => {
    expect(welcomeHelperState('off', 'off', null)).toEqual({ kind: 'off' })
    expect(welcomeHelperState('off', 'default', { name: 'Welcome', category: 'MARKETING' })).toEqual({ kind: 'off' })
  })

  it('default choice not yet saved (differs from lastSavedChoice) -> pending, never guesses a name', () => {
    expect(welcomeHelperState('default', 'off', null)).toEqual({ kind: 'defaultPending' })
    expect(welcomeHelperState('default', 'off', { name: 'Welcome', category: 'MARKETING' })).toEqual({
      kind: 'defaultPending',
    })
  })

  it('default choice matching the saved value with a resolved template -> resolved, marketingNote true for MARKETING', () => {
    expect(welcomeHelperState('default', 'default', { name: 'Welcome', category: 'MARKETING' })).toEqual({
      kind: 'defaultResolved',
      name: 'Welcome',
      category: 'MARKETING',
      marketingNote: true,
    })
  })

  it('default choice matching saved, UTILITY category -> marketingNote false', () => {
    expect(welcomeHelperState('default', 'default', { name: 'Setup done', category: 'UTILITY' })).toEqual({
      kind: 'defaultResolved',
      name: 'Setup done',
      category: 'UTILITY',
      marketingNote: false,
    })
  })

  it('default choice matching saved but no resolvedTemplate (degraded) -> pending, not a crash', () => {
    expect(welcomeHelperState('default', 'default', null)).toEqual({ kind: 'defaultPending' })
  })
})

// -- pure view ------------------------------------------------------------

function baseProps(overrides: Partial<WelcomeTemplateViewProps> = {}): WelcomeTemplateViewProps {
  return {
    lockedSpecific: false,
    specificName: null,
    specificCategory: null,
    choice: 'off',
    lastSavedChoice: 'off',
    resolvedTemplate: null,
    onChoiceChange: vi.fn(),
    saving: false,
    saved: false,
    warning: null,
    errorCode: null,
    onSave: vi.fn(),
    canSave: true,
    ...overrides,
  }
}

describe('WelcomeTemplateView — launch choices (OD-1: Off / Tenant default only)', () => {
  it('shows both Off and Tenant default radios when not locked to a specific id', () => {
    const tree = renderTree(<WelcomeTemplateView {...baseProps({ lockedSpecific: false })} />)
    expect(byTestId(tree, 'welcome-choice-off')).toBeDefined()
    expect(byTestId(tree, 'welcome-choice-default')).toBeDefined()
  })

  it('a specific template id: shows the read-only display and Off as the ONLY other choice', () => {
    const tree = renderTree(
      <WelcomeTemplateView
        {...baseProps({ lockedSpecific: true, specificName: 'Loyalty Welcome', specificCategory: 'MARKETING' })}
      />
    )
    expect(byTestId(tree, 'welcome-specific-readonly')).toBeDefined()
    expect(textOf(byTestId(tree, 'welcome-specific-readonly'))).toContain('Loyalty Welcome')
    expect(byTestId(tree, 'welcome-choice-off')).toBeDefined()
    expect(byTestId(tree, 'welcome-choice-default')).toBeUndefined()
  })

  it('fires onChoiceChange when a radio is picked', () => {
    const onChoiceChange = vi.fn()
    const tree = renderTree(<WelcomeTemplateView {...baseProps({ onChoiceChange })} />)
    ;(byTestId(tree, 'welcome-choice-default')!.props as { onChange: () => void }).onChange()
    expect(onChoiceChange).toHaveBeenCalledWith('default')
  })
})

describe('WelcomeTemplateView — helper copy per state (§8.3)', () => {
  it('off -> the "no message, no coupon" helper', () => {
    const tree = renderTree(<WelcomeTemplateView {...baseProps({ choice: 'off' })} />)
    expect(byTestId(tree, 'welcome-helper-off')).toBeDefined()
  })

  it('default resolved with MARKETING category -> shows the consent_level:all note', () => {
    const tree = renderTree(
      <WelcomeTemplateView
        {...baseProps({
          choice: 'default',
          lastSavedChoice: 'default',
          resolvedTemplate: { name: 'Welcome', category: 'MARKETING' },
        })}
      />
    )
    expect(byTestId(tree, 'welcome-marketing-note')).toBeDefined()
  })

  it('default resolved with UTILITY category -> no marketing note', () => {
    const tree = renderTree(
      <WelcomeTemplateView
        {...baseProps({
          choice: 'default',
          lastSavedChoice: 'default',
          resolvedTemplate: { name: 'Setup', category: 'UTILITY' },
        })}
      />
    )
    expect(byTestId(tree, 'welcome-marketing-note')).toBeUndefined()
  })
})

describe('WelcomeTemplateView — warning (§8.3 tenant_quality_paused)', () => {
  it('shows the quality-paused warning when present', () => {
    const tree = renderTree(<WelcomeTemplateView {...baseProps({ warning: 'tenant_quality_paused' })} />)
    expect(byTestId(tree, 'welcome-warning-paused')).toBeDefined()
  })

  it('shows nothing when there is no warning', () => {
    const tree = renderTree(<WelcomeTemplateView {...baseProps({ warning: null })} />)
    expect(byTestId(tree, 'welcome-warning-paused')).toBeUndefined()
  })
})

describe('WelcomeTemplateView — rejected (§8.3 no_default_welcome_template)', () => {
  it('renders the mapped error message and a link to the templates page', () => {
    const tree = renderTree(<WelcomeTemplateView {...baseProps({ errorCode: 'no_default_welcome_template' })} />)
    expect(textOf(byTestId(tree, 'welcome-error'))).toContain('t:errorNoDefaultTemplate')
    const link = byTestId(tree, 'welcome-error-link')
    expect(link).toBeDefined()
    expect((link!.props as { href: string }).href).toBe('/dashboard/wa-templates')
  })

  it('renders other error codes without the template link', () => {
    const tree = renderTree(<WelcomeTemplateView {...baseProps({ errorCode: 'network_error' })} />)
    expect(byTestId(tree, 'welcome-error')).toBeDefined()
    expect(byTestId(tree, 'welcome-error-link')).toBeUndefined()
  })
})

describe('WelcomeTemplateView — save button', () => {
  it('is disabled while saving', () => {
    const tree = renderTree(<WelcomeTemplateView {...baseProps({ saving: true })} />)
    expect((byTestId(tree, 'welcome-save')!.props as { disabled: boolean }).disabled).toBe(true)
  })

  it('is disabled when canSave is false (locked-specific, not yet switched to Off)', () => {
    const tree = renderTree(<WelcomeTemplateView {...baseProps({ canSave: false })} />)
    expect((byTestId(tree, 'welcome-save')!.props as { disabled: boolean }).disabled).toBe(true)
  })

  it('fires onSave when clicked', () => {
    const onSave = vi.fn()
    const tree = renderTree(<WelcomeTemplateView {...baseProps({ onSave })} />)
    ;(byTestId(tree, 'welcome-save')!.props as { onClick: () => void }).onClick()
    expect(onSave).toHaveBeenCalled()
  })

  it('shows a saved indicator only when saved and there is no error', () => {
    const savedTree = renderTree(<WelcomeTemplateView {...baseProps({ saved: true, errorCode: null })} />)
    expect(byTestId(savedTree, 'welcome-saved')).toBeDefined()

    const erroredTree = renderTree(<WelcomeTemplateView {...baseProps({ saved: true, errorCode: 'url_invalid' })} />)
    expect(byTestId(erroredTree, 'welcome-saved')).toBeUndefined()
  })
})
