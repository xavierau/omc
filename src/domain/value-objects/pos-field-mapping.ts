import type { PosTransactionType } from '../entities/pos-transaction'

export interface PosFieldMapping {
  transactionId: string
  amount: string
  currency: string
  eventType: string
  eventTypeMapping: Record<string, PosTransactionType>
  customerPhone: string | null
  timestamp: string | null
}

const REQUIRED_STRING_FIELDS: ReadonlyArray<keyof PosFieldMapping> = [
  'transactionId',
  'amount',
  'currency',
  'eventType',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateFieldMapping(
  input: unknown
): input is PosFieldMapping {
  if (!isRecord(input)) return false

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof input[field] !== 'string') return false
  }

  if (!isRecord(input.eventTypeMapping)) return false

  return true
}
