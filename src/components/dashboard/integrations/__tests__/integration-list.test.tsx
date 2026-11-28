// INT-001 WI-9 — frozen acceptance suite for `IntegrationListView` (pure).
// Derived from spec's admin-only-controls requirement and T-M9 (escaped
// rendering), not from the implementation.

import { describe, it, expect, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `t:${key}:${JSON.stringify(vars)}` : `t:${key}`,
}))

import {
  IntegrationListView,
  type IntegrationListViewProps,
} from '@/components/dashboard/integrations/integration-list'
import type { PublicIntegration } from '@/hooks/integrations-client'
import { renderTree, byTestId, allByTestId, textOf } from './render-tree-test-utils'

function integration(overrides: Partial<PublicIntegration> = {}): PublicIntegration {
  return {
    id: 'i-1',
    restaurantId: 'r-1',
    provider: 'generic',
    name: 'Square POS',
    status: 'active',
    fieldMapping: null,
    secretLast4: 'ab12',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function baseProps(overrides: Partial<IntegrationListViewProps> = {}): IntegrationListViewProps {
  return {
    integrations: [],
    isAdmin: true,
    name: '',
    onNameChange: vi.fn(),
    onCreate: vi.fn(),
    creating: false,
    createError: null,
    ...overrides,
  }
}

describe('IntegrationListView — admin-only controls (staff sees no mutating controls)', () => {
  it('shows the create form for an admin', () => {
    const tree = renderTree(<IntegrationListView {...baseProps({ isAdmin: true })} />)
    expect(byTestId(tree, 'integration-create-form')).toBeDefined()
  })

  it('hides the create form for staff', () => {
    const tree = renderTree(<IntegrationListView {...baseProps({ isAdmin: false })} />)
    expect(byTestId(tree, 'integration-create-form')).toBeUndefined()
  })
})

describe('IntegrationListView — rows', () => {
  it('renders one row per integration, linking to its detail page', () => {
    const tree = renderTree(
      <IntegrationListView {...baseProps({ integrations: [integration({ id: 'i-42' })] })} />
    )
    const row = byTestId(tree, 'integration-row-i-42')
    expect(row).toBeDefined()
    expect((row!.props as { href: string }).href).toBe('/dashboard/integrations/i-42')
  })

  it('shows the empty state when there are no integrations', () => {
    const tree = renderTree(<IntegrationListView {...baseProps({ integrations: [] })} />)
    expect(byTestId(tree, 'integration-rows')).toBeUndefined()
  })

  it('does not render the row list container when empty', () => {
    const tree = renderTree(<IntegrationListView {...baseProps({ integrations: [integration()] })} />)
    expect(byTestId(tree, 'integration-rows')).toBeDefined()
  })

  // T-M9: a partner/owner-controlled name must never be interpreted as
  // markup. React's default text-child escaping covers this as long as no
  // dangerouslySetInnerHTML is used — asserted structurally: the raw string
  // (script tag included) shows up as literal text content.
  it('renders an integration name containing markup as literal text (escaped rendering)', () => {
    const malicious = '<script>alert(1)</script>'
    const tree = renderTree(
      <IntegrationListView {...baseProps({ integrations: [integration({ id: 'i-9', name: malicious })] })} />
    )
    const row = byTestId(tree, 'integration-row-i-9')
    expect(textOf(row)).toContain(malicious)
  })

  it('shows an active-status badge with the common.active label', () => {
    const tree = renderTree(
      <IntegrationListView {...baseProps({ integrations: [integration({ status: 'active' })] })} />
    )
    const row = byTestId(tree, 'integration-row-i-1')
    expect(textOf(row)).toContain('t:active')
  })

  it('shows an inactive-status badge with the common.inactive label', () => {
    const tree = renderTree(
      <IntegrationListView {...baseProps({ integrations: [integration({ status: 'inactive' })] })} />
    )
    const row = byTestId(tree, 'integration-row-i-1')
    expect(textOf(row)).toContain('t:inactive')
  })
})

describe('IntegrationListView — create form', () => {
  it('fires onNameChange as the input value changes', () => {
    const onNameChange = vi.fn()
    const tree = renderTree(<IntegrationListView {...baseProps({ onNameChange })} />)
    const input = byTestId(tree, 'integration-create-name-input')
    ;(input!.props as { onChange: (e: unknown) => void }).onChange({ target: { value: 'New Co' } })
    expect(onNameChange).toHaveBeenCalledWith('New Co')
  })

  it('fires onCreate when the submit button is clicked', () => {
    const onCreate = vi.fn()
    const tree = renderTree(<IntegrationListView {...baseProps({ onCreate })} />)
    const button = byTestId(tree, 'integration-create-submit')
    ;(button!.props as { onClick: () => void }).onClick()
    expect(onCreate).toHaveBeenCalled()
  })

  it('disables the submit button and shows creating text while creating', () => {
    const tree = renderTree(<IntegrationListView {...baseProps({ creating: true })} />)
    const button = byTestId(tree, 'integration-create-submit')
    expect((button!.props as { disabled: boolean }).disabled).toBe(true)
    expect(textOf(button)).toBe('t:creating')
  })

  it('renders the create error when present', () => {
    const tree = renderTree(<IntegrationListView {...baseProps({ createError: 'Name required' })} />)
    expect(allByTestId(tree, 'integration-create-error')).toHaveLength(1)
    expect(textOf(byTestId(tree, 'integration-create-error'))).toBe('Name required')
  })
})
