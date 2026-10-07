// INT-001 WI-6 T-M2: read-only anomaly stats over `integration_member_jobs`
// (WI-3's table -- this file only ever SELECTs from it, never writes,
// avoiding any collision with WI-3's own repository file for that table).
// "Per integration, last hour existing/created volume vs a 7-day hourly
// baseline; > 3x -> engineering_alert" (plan §Sweeper).
//
// Scale caveat (disclosed, not silently accepted): this reads every
// `succeeded` job row in the trailing 7 days and aggregates client-side --
// fine at INT-001's current expected volumes, but a genuinely busy
// integration would be better served by a SQL aggregate/RPC. Flagged as a
// follow-up in the WI-6 implementation note rather than building a new RPC
// function outside this work item's migration boundary.

import { createServerSupabaseClient } from '../client'

export interface IntegrationVolumeAnomaly {
  integrationId: string
  restaurantId: string
  lastHourCount: number
  sevenDayHourlyAverage: number
}

interface JobRow {
  integration_id: string
  restaurant_id: string
  submitted_at: string
}

export async function findIntegrationVolumeAnomalies(args: {
  multiplier: number
  minLastHourVolume: number
}): Promise<IntegrationVolumeAnomaly[]> {
  const supabase = createServerSupabaseClient()
  const now = Date.now()
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString()
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('integration_member_jobs')
    .select('integration_id, restaurant_id, submitted_at')
    .eq('status', 'succeeded')
    .gte('submitted_at', sevenDaysAgo)
  if (error) throw new Error(`findIntegrationVolumeAnomalies: ${error.message}`)

  const rows = (data ?? []) as JobRow[]
  const lastHourCounts = new Map<string, number>()
  const priorWindowCounts = new Map<string, number>()
  const restaurantByIntegration = new Map<string, string>()

  for (const row of rows) {
    restaurantByIntegration.set(row.integration_id, row.restaurant_id)
    if (row.submitted_at >= oneHourAgo) {
      lastHourCounts.set(row.integration_id, (lastHourCounts.get(row.integration_id) ?? 0) + 1)
    } else {
      priorWindowCounts.set(row.integration_id, (priorWindowCounts.get(row.integration_id) ?? 0) + 1)
    }
  }

  const priorWindowHours = 7 * 24 - 1
  const anomalies: IntegrationVolumeAnomaly[] = []
  for (const [integrationId, lastHourCount] of lastHourCounts) {
    if (lastHourCount < args.minLastHourVolume) continue
    const priorCount = priorWindowCounts.get(integrationId) ?? 0
    const sevenDayHourlyAverage = priorCount / priorWindowHours
    if (lastHourCount > sevenDayHourlyAverage * args.multiplier) {
      anomalies.push({
        integrationId,
        restaurantId: restaurantByIntegration.get(integrationId) ?? '',
        lastHourCount,
        sevenDayHourlyAverage,
      })
    }
  }
  return anomalies
}
