import crypto from 'crypto'
import {
  createPosIntegration,
  updatePosIntegration,
  deletePosIntegration,
  findPosIntegrationById,
  findPosIntegrationsByRestaurant,
} from '@/infrastructure/supabase/repositories/pos-integration-repository'
import { validateFieldMapping } from '@/domain/value-objects/pos-field-mapping'
import type { PosProvider } from '@/domain/entities/pos-integration'
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
  await updatePosIntegration(id, updates)
}

export async function deleteIntegration(id: string): Promise<void> {
  await deletePosIntegration(id)
}

export async function getIntegration(id: string) {
  return findPosIntegrationById(id)
}

export async function listIntegrations(restaurantId: string) {
  return findPosIntegrationsByRestaurant(restaurantId)
}

export function regenerateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex')
}
