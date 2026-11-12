import type { PosFieldMapping } from '../value-objects/pos-field-mapping'
import type { PosTransactionType } from '../entities/pos-transaction'

export interface PosWebhookEvent {
  externalTransactionId: string
  type: PosTransactionType
  amount: number
  currency: string
  customerPhone: string | null
  timestamp: string
  rawPayload: Record<string, unknown>
}

export interface PosWebhookPort {
  parse(body: unknown, mapping?: PosFieldMapping): PosWebhookEvent | null
  verifySignature(body: string, signature: string, secret: string): boolean
}
