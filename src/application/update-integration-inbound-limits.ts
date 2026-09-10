// INT-001 WI-2: platform-admin override of per-integration inbound
// rate/queue-cap settings (spec US-5). Used by
// /api/admin/integrations/[id]/limits (PATCH) -- never by a tenant-facing
// route (those limits are platform-admin only, not owner-configurable).

import {
  findIntegrationSettingsById,
  updateIntegrationInboundLimits as updateRow,
  type UpdateIntegrationInboundLimitsArgs,
} from '@/infrastructure/supabase/repositories/integration-settings-repository'
import type { IntegrationSettings } from '@/domain/entities/integration-settings'

export type UpdateIntegrationInboundLimitsInput = UpdateIntegrationInboundLimitsArgs

/**
 * Returns the refreshed entity, or null if the integration has no
 * `integration_settings` row (never writes in that case).
 */
export async function updateIntegrationInboundLimits(
  integrationId: string,
  input: UpdateIntegrationInboundLimitsInput
): Promise<IntegrationSettings | null> {
  const existing = await findIntegrationSettingsById(integrationId)
  if (!existing) return null
  await updateRow(integrationId, input)
  return findIntegrationSettingsById(integrationId)
}
