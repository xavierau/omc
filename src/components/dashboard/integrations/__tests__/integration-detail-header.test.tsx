import { describe, it, expect, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}))

import { IntegrationDetailHeader } from '@/components/dashboard/integrations/integration-detail-header'
import { renderTree, byTestId, textOf } from './render-tree-test-utils'

describe('IntegrationDetailHeader', () => {
  it('renders the name and provider', () => {
    const tree = renderTree(
      <IntegrationDetailHeader integration={{ name: 'Square POS', status: 'active', provider: 'square' }} />
    )
    expect(textOf(byTestId(tree, 'integration-detail-name'))).toBe('Square POS')
    expect(textOf(byTestId(tree, 'integration-detail-provider'))).toBe('square')
  })

  it('renders an active-status badge with the common.active label', () => {
    const tree = renderTree(
      <IntegrationDetailHeader integration={{ name: 'X', status: 'active', provider: 'generic' }} />
    )
    expect(textOf(byTestId(tree, 'integration-detail-status'))).toBe('t:active')
  })

  it('renders an inactive-status badge with the common.inactive label', () => {
    const tree = renderTree(
      <IntegrationDetailHeader integration={{ name: 'X', status: 'inactive', provider: 'generic' }} />
    )
    expect(textOf(byTestId(tree, 'integration-detail-status'))).toBe('t:inactive')
  })

  // T-M9: escaped rendering — an integration name is owner-entered (the
  // create form) but must still never be interpreted as markup.
  it('renders a name containing markup as literal text', () => {
    const malicious = '<img src=x onerror=alert(1)>'
    const tree = renderTree(
      <IntegrationDetailHeader integration={{ name: malicious, status: 'active', provider: 'generic' }} />
    )
    expect(textOf(byTestId(tree, 'integration-detail-name'))).toBe(malicious)
  })
})
