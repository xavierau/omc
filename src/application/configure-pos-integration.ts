import crypto from 'crypto'
import {
  createPosIntegration,
  updatePosIntegration,
  deletePosIntegration,
  findPosIntegrationByIdForRestaurant,
  findPosIntegrationsByRestaurant,
} from '@/infrastructure/supabase/repositories/pos-integration-repository'
import { validateFieldMapping } from '@/domain/value-objects/pos-field-mapping'
import type { PosIntegration, PosProvider } from '@/domain/entities/pos-integration'
import type { PosFieldMapping } from '@/domain/value-objects/pos-field-mapping'

interface CreateInput {
  restaurantId: string
  provider?: PosProvider
  name: string
  fieldMapping?: PosFieldMapping
  credentials?: Record<string, unknown>
}

interface CreateResult {
  id: string
  webhookUrl: string
  webhookSecret: string
}

export async function createIntegration(input: CreateInput): Promise<CreateResult> {
  if (input.fieldMapping && !validateFieldMapping(input.fieldMapping)) {
    throw new Error('Invalid field mapping: transactionId, amount, eventType, and eventTypeMapping are required')
  }

  const webhookSecret = crypto.randomBytes(32).toString('hex')
  const id = await createPosIntegration({
    restaurantId: input.restaurantId,
    provider: input.provider ?? 'generic',
    name: input.name,
    status: 'active',
    webhookSecret,
    fieldMapping: input.fieldMapping ?? null,
    credentials: input.credentials ?? null,
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL ?? 'http://localhost:3000'
  const webhookUrl = `${appUrl}/api/webhooks/pos/${id}`

  return { id, webhookUrl, webhookSecret }
}

export async function updateIntegration(
  id: string,
  updates: { name?: string; status?: 'active' | 'inactive'; fieldMapping?: PosFieldMapping; credentials?: Record<string, unknown> }
): Promise<void> {
  if (updates.fieldMapping && !validateFieldMapping(updates.fieldMapping)) {
    throw new Error('Invalid field mapping')
  }
  // Defense in depth: forward an explicit allowlist to the repository,
  // independent of the route-level parseIntegrationPatch check — `updates`
  // is a variable, not an object literal, so TS excess-property checking
  // does not stop an extra key (e.g. webhookSecret) from riding along at
  // runtime if a future caller skips the route validator (T-C4).
  const safeUpdates: Partial<Pick<PosIntegration, 'name' | 'status' | 'fieldMapping' | 'credentials'>> = {}
  if (updates.name !== undefined) safeUpdates.name = updates.name
  if (updates.status !== undefined) safeUpdates.status = updates.status
  if (updates.fieldMapping !== undefined) safeUpdates.fieldMapping = updates.fieldMapping
  if (updates.credentials !== undefined) safeUpdates.credentials = updates.credentials
  await updatePosIntegration(id, safeUpdates)
}

export async function deleteIntegration(id: string): Promise<void> {
  await deletePosIntegration(id)
}

/**
 * Scoped by restaurantId in the query itself (not fetch-then-compare) so a
 * foreign integration id 404s instead of leaking existence (issue #111
 * lesson, T-M5).
 */
export async function getIntegration(id: string, restaurantId: string) {
  return findPosIntegrationByIdForRestaurant(id, restaurantId)
}

export async function listIntegrations(restaurantId: string) {
  return findPosIntegrationsByRestaurant(restaurantId)
}

export function regenerateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * The ONE place allowed to set webhook_secret (T-C4 — never via PATCH).
 * No migration yet (069 lands in WI-1), so rotation audit is a console log
 * for now; WI-1 adds the integration_settings_audit row.
 */
export async function rotateInboundSecret(id: string, rotatedBy: string): Promise<string> {
  const webhookSecret = regenerateWebhookSecret()
  await updatePosIntegration(id, { webhookSecret })
  console.info('pos_integration.inbound_secret_rotated', {
    integrationId: id,
    rotatedBy,
    at: new Date().toISOString(),
  })
  return webhookSecret
}
