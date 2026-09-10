export type PosTransactionType = 'sale' | 'refund'

export interface PosTransaction {
  id: string
  posIntegrationId: string
  restaurantId: string
  memberId: string | null
  externalTransactionId: string
  type: PosTransactionType
  amount: number
  currency: string
  customerPhone: string | null
  pointsAwarded: number
  rawPayload: Record<string, unknown>
  processedAt: string
}
