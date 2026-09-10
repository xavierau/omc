import type { PosFieldMapping } from '../value-objects/pos-field-mapping'

export type PosProvider = 'generic' | 'ichef' | 'square'

export interface PosIntegration {
  id: string
  restaurantId: string
  provider: PosProvider
  name: string
  status: 'active' | 'inactive'
  webhookSecret: string | null
  fieldMapping: PosFieldMapping | null
  credentials: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}
