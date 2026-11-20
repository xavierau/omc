// WAQ-010: per-tenant probe-pacing strategy.
//
// `engagement_tier` (default) — sort by `members.last_visit_at` DESC, then
// chunk: probe-size first, scale-size thereafter. The probe targets the most
// engaged tier so KPI risk is bounded if a tenant's reputation softens.
//
// `naive` is preserved as opt-out for tenants who relied on the legacy
// BATCH_SIZE=20 behaviour and don't want sorting.
//
// Active-hours fields are exposed for Phase 2 (cron-driven probe → wait →
// scale) but are advisory in Phase 1 — `isInActiveHours` lets callers log
// when a sync run starts outside business hours without blocking it.

export type PacingStrategy = 'engagement_tier' | 'naive'

export interface PacingConfig {
  strategy: PacingStrategy
  probeChunkSize: number
  scaleChunkSize: number
  activeHoursStartLocal: string // 'HH:MM:SS'
  activeHoursEndLocal: string // 'HH:MM:SS'
  tenantTimezone: string
}

// Phase-1 default — also used as the fallback when no tenant_campaign_settings
// row exists yet (e.g. brand-new tenants).
export const DEFAULT_PACING_CONFIG: PacingConfig = {
  strategy: 'engagement_tier',
  probeChunkSize: 100,
  scaleChunkSize: 100,
  activeHoursStartLocal: '10:00:00',
  activeHoursEndLocal: '22:00:00',
  tenantTimezone: 'Asia/Hong_Kong',
}

// Returns true if `at` (UTC instant) falls within [start, end) in the
// tenant's local timezone. End is exclusive so 22:00 sharp returns false —
// matches the spec's "no overnight sends" requirement.
export function isInActiveHours(at: Date, config: PacingConfig): boolean {
  const localSeconds = secondsSinceMidnightInZone(at, config.tenantTimezone)
  const startSeconds = parseHmsToSeconds(config.activeHoursStartLocal)
  const endSeconds = parseHmsToSeconds(config.activeHoursEndLocal)
  return localSeconds >= startSeconds && localSeconds < endSeconds
}

function parseHmsToSeconds(hms: string): number {
  const [h, m, s] = hms.split(':').map((n) => parseInt(n, 10))
  return h * 3600 + m * 60 + (s ?? 0)
}

// Use Intl.DateTimeFormat to pull H/M/S in the tenant's timezone — avoids any
// dependency on a TZ database beyond what Node ships natively.
function secondsSinceMidnightInZone(at: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(at)
  const get = (type: string): number =>
    parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10)
  // `hour: '2-digit'` with `hour12: false` returns '24' for midnight in some
  // locales; normalize to 0 to keep the comparison sane.
  const hour = get('hour') === 24 ? 0 : get('hour')
  return hour * 3600 + get('minute') * 60 + get('second')
}
