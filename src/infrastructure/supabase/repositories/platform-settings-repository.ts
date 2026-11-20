// platform_settings reads for the application layer (migration 051). Holds the
// platform-admin-level stamp cap policy (plan §9). Single-row table; the read is
// fail-safe: an absent/unreadable row falls back to the founder default (warn at
// threshold 1) so the campaign editor never hard-fails on a settings hiccup.
import { createServerSupabaseClient } from '../client'
import type {
  StampCapEnforcement,
  StampCapPolicy,
} from '@/domain/services/stamp-cap-policy'

const DEFAULT_POLICY: StampCapPolicy = { enforcement: 'warn', warnThreshold: 1 }

export async function getStampCapPolicy(): Promise<StampCapPolicy> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('platform_settings')
    .select('stamp_cap_enforcement, stamp_cap_warn_threshold')
    .single()

  if (error || !data) return DEFAULT_POLICY
  return {
    enforcement: data.stamp_cap_enforcement as StampCapEnforcement,
    warnThreshold: Number(data.stamp_cap_warn_threshold),
  }
}
