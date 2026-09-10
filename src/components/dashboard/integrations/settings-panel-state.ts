// INT-001 WI-15 — pure state resolver for every UI slot in `[id]/page.tsx`
// that used to be gated on the single `isAdmin && settings` truthy check
// (the Settings-tab cards, the paused banner, and the Deliveries tab body).
// That one ternary conflated two very different reasons the "ready" content
// wouldn't show: the caller genuinely isn't a tenant admin, vs. the settings
// fetch itself failed for an unrelated reason (500 / network / any non-2xx
// other than 403) — see tests/2026-09-10-int-001-ui-walk.md's Anomalies #1
// and #2. A 403 from `GET .../settings` is treated the same as `!isAdmin`:
// the route calls `requireTenantAdmin` server-side, so a 403 there means the
// caller isn't really an admin regardless of what the client's own cached
// `useTenant()` role says (e.g. a just-revoked role). Any other failure is a
// real error and must never render the "you're not an admin" copy to an
// actual admin.

export type SettingsPanelState = 'ready' | 'roleMessage' | 'error' | 'pending'

/**
 * @param isAdmin client-derived tenant-admin check (`isTenantAdmin`) — the
 *   same gate that decides whether the settings fetch is even attempted.
 * @param hasSettings whether the settings fetch has succeeded (`!!settings`).
 * @param settingsErrorStatus the failed settings fetch's HTTP status, or
 *   `null` if it hasn't failed (either it succeeded, or hasn't resolved yet).
 */
export function resolveSettingsPanelState(
  isAdmin: boolean,
  hasSettings: boolean,
  settingsErrorStatus: number | null
): SettingsPanelState {
  if (!isAdmin) return 'roleMessage'
  if (hasSettings) return 'ready'
  if (settingsErrorStatus === 403) return 'roleMessage'
  if (settingsErrorStatus !== null) return 'error'
  return 'pending'
}
