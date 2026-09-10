import { describe, it, expect } from 'vitest'
import { resolveSettingsPanelState } from '@/components/dashboard/integrations/settings-panel-state'

// INT-001 WI-15 — frozen acceptance suite for the pure resolver that
// replaces `[id]/page.tsx`'s old `isAdmin && settings` ternary at every
// gated slot (Settings-tab cards, paused banner, Deliveries tab). Derived
// from tests/2026-09-10-int-001-ui-walk.md's Anomalies #1 (settings cards +
// paused banner vanish silently on a non-403 settings-fetch failure) and #2
// (Deliveries tab shows the "admin only" message to a real admin on a
// non-403 failure) — not from the implementation.
describe('resolveSettingsPanelState', () => {
  it('is always roleMessage for a non-admin, regardless of settings/error state', () => {
    expect(resolveSettingsPanelState(false, false, null)).toBe('roleMessage')
    expect(resolveSettingsPanelState(false, true, null)).toBe('roleMessage')
    expect(resolveSettingsPanelState(false, false, 500)).toBe('roleMessage')
    expect(resolveSettingsPanelState(false, false, 403)).toBe('roleMessage')
  })

  it('is ready when an admin has settings, even if a stale error status lingers', () => {
    expect(resolveSettingsPanelState(true, true, null)).toBe('ready')
    expect(resolveSettingsPanelState(true, true, 500)).toBe('ready')
  })

  it('treats a 403 from the settings fetch as the role message, never an error panel (Anomaly #2)', () => {
    expect(resolveSettingsPanelState(true, false, 403)).toBe('roleMessage')
  })

  it.each([500, 502, 400, 404, 0])(
    'treats a non-403 settings-fetch failure (status %s) as a real error, never the role message (Anomaly #1/#2)',
    (status) => {
      expect(resolveSettingsPanelState(true, false, status)).toBe('error')
    }
  )

  it('is pending when an admin has neither settings nor a recorded error yet (mid-fetch)', () => {
    expect(resolveSettingsPanelState(true, false, null)).toBe('pending')
  })
})
