import type { PosIntegration } from '@/domain/entities/pos-integration'

/**
 * Dashboard-safe projection of a POS integration. Every dashboard read MUST
 * go through this — `webhookSecret` and `credentials` never cross the route
 * boundary (T-H1). `secretLast4` lets an admin confirm which secret is
 * active without ever re-displaying it.
 */
export interface PublicIntegration {
  id: string
  restaurantId: string
  provider: PosIntegration['provider']
  name: string
  status: PosIntegration['status']
  fieldMapping: PosIntegration['fieldMapping']
  secretLast4: string | null
  createdAt: string
  updatedAt: string
}

export function toPublicIntegration(integration: PosIntegration): PublicIntegration {
  return {
    id: integration.id,
    restaurantId: integration.restaurantId,
    provider: integration.provider,
    name: integration.name,
    status: integration.status,
    fieldMapping: integration.fieldMapping,
    secretLast4: integration.webhookSecret ? integration.webhookSecret.slice(-4) : null,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  }
}
