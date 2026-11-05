import { describe, it, expect, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `t:${key}:${JSON.stringify(vars)}` : `t:${key}`,
}))

import { SettingsErrorPanel } from '@/components/dashboard/integrations/settings-error-panel'
import { renderTree, byTestId, textOf } from './render-tree-test-utils'

// INT-001 WI-15 — the shared rejected-state panel used everywhere a slot is
// gated on the settings fetch (Settings-tab cards, Deliveries tab body,
// paused-banner slot). Must reuse settings-error-messages.ts's mapping
// (generic fallback for an unrecognized code) and always offer Retry —
// never render blank (Anomaly #1).
describe('SettingsErrorPanel', () => {
  it('renders the mapped message for a known settings-route error code', () => {
    const tree = renderTree(
      <SettingsErrorPanel errorCode="url_not_https" onRetry={vi.fn()} testId="settings-fetch-error" />
    )
    expect(textOf(byTestId(tree, 'settings-fetch-error'))).toContain('t:errorUrlNotHttps')
  })

  it('falls back to the generic message for an unrecognized/free-text code (e.g. a raw 500 body)', () => {
    const tree = renderTree(
      <SettingsErrorPanel errorCode="Failed to load settings" onRetry={vi.fn()} testId="settings-fetch-error" />
    )
    expect(textOf(byTestId(tree, 'settings-fetch-error'))).toContain('t:errorGeneric')
  })

  it('renders at the given testId so multiple panel instances on one page stay distinguishable', () => {
    const tree = renderTree(
      <SettingsErrorPanel errorCode="network_error" onRetry={vi.fn()} testId="deliveries-fetch-error" />
    )
    expect(byTestId(tree, 'deliveries-fetch-error')).toBeDefined()
    expect(byTestId(tree, 'settings-fetch-error')).toBeUndefined()
  })

  it('fires onRetry when the Retry button is clicked', () => {
    const onRetry = vi.fn()
    const tree = renderTree(<SettingsErrorPanel errorCode="network_error" onRetry={onRetry} testId="x" />)
    const button = byTestId(tree, 'x-retry')
    ;(button!.props as { onClick: () => void }).onClick()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
