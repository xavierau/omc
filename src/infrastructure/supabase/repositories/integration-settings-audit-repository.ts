// INT-001 T-M1: field-level audit trail for `integration_settings` writes
// (WI-8 calls this after every successful field mutation). Secrets are
// logged as last4 only -- callers must never pass a plaintext or ciphertext
// secret as `oldValue`/`newValue`.

import { randomUUID } from 'node:crypto'
import { createServerSupabaseClient } from '../client'

export interface RecordIntegrationSettingsAuditArgs {
  integrationId: string
  restaurantId: string
  actorUserId: string | null
  field: string
  oldValue: string | null
  newValue: string | null
}

export async function recordIntegrationSettingsAudit(
  args: RecordIntegrationSettingsAuditArgs
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase.from('integration_settings_audit').insert({
    id: randomUUID(),
    integration_id: args.integrationId,
    restaurant_id: args.restaurantId,
    actor_user_id: args.actorUserId,
    field: args.field,
    old_value: args.oldValue,
    new_value: args.newValue,
  })
  if (error) throw new Error(`recordIntegrationSettingsAudit: ${error.message}`)
}
