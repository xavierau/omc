// WAQ-009: writes to the auto-throttle / auto-pause columns on
// `tenant_campaign_settings` (migration 042). Service-role writes only —
// `createServerSupabaseClient()` bypasses RLS by design (mirrors the
// posture of `whatsapp-message-repository.ts` and quality-state-repository).
//
// Idempotent on repeat: every helper UPSERTs by `restaurant_id` so a webhook
// retry of the same transition simply re-applies the same row state.

import { createServerSupabaseClient } from '../client'
import type { AutoPauseReason } from '@/domain/services/campaign-guardrails'

const TABLE = 'tenant_campaign_settings'
const ON_CONFLICT = 'restaurant_id'

export async function applyAutoThrottle(
  restaurantId: string,
  factor: number
): Promise<void> {
  // NOTE: do NOT touch `auto_pause_set_at` here — that column tracks the
  // moment the tenant entered the auto-paused state, not "when any auto
  // action was last taken". WAQ-013 alerting reads it as "paused since X".
  await upsertAutoFlags(restaurantId, {
    auto_throttle_factor: factor,
  })
}

export async function applyAutoPause(
  restaurantId: string,
  reason: AutoPauseReason
): Promise<void> {
  await upsertAutoFlags(restaurantId, {
    auto_pause_active: true,
    auto_pause_reason: reason,
    auto_pause_set_at: nowIso(),
  })
}

/**
 * Platform-admin-only override: drops the tenant out of auto-throttle and
 * auto-pause. Does NOT touch the manual `campaign_paused` switch.
 */
export async function clearAutoQualityFlags(
  restaurantId: string
): Promise<void> {
  await upsertAutoFlags(restaurantId, {
    auto_throttle_factor: 1,
    auto_pause_active: false,
    auto_pause_reason: null,
    auto_pause_set_at: null,
  })
}

async function upsertAutoFlags(
  restaurantId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from(TABLE)
    .upsert({ restaurant_id: restaurantId, ...patch }, { onConflict: ON_CONFLICT })
  if (error) throw new Error(`auto-flags upsert: ${error.message}`)
}

function nowIso(): string {
  return new Date().toISOString()
}
