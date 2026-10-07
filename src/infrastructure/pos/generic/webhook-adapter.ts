import crypto from 'crypto'
import type { PosWebhookPort, PosWebhookEvent } from '@/domain/ports/pos-webhook'
import type { PosFieldMapping } from '@/domain/value-objects/pos-field-mapping'

export function resolveJsonPath(obj: unknown, path: string): unknown {
  if (!path.startsWith('$.')) return path
  const parts = path.slice(2).split(/\.|\[(\d+)\]/).filter(Boolean)
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function createGenericWebhookAdapter(): PosWebhookPort {
  return { parse, verifySignature }
}

function parse(
  body: unknown,
  mapping?: PosFieldMapping
): PosWebhookEvent | null {
  if (!mapping || !body) return null

  const txId = resolveJsonPath(body, mapping.transactionId)
  const amount = Number(resolveJsonPath(body, mapping.amount))
  const rawEventType = String(resolveJsonPath(body, mapping.eventType))
  const currency = resolveCurrency(body, mapping)
  const customerPhone = resolvePhone(body, mapping)
  const timestamp = resolveTimestamp(body, mapping)

  if (!txId || isNaN(amount) || amount <= 0 || amount > 10_000_000) return null

  const type = mapping.eventTypeMapping[rawEventType]
  if (!type) return null

  return {
    externalTransactionId: String(txId),
    type,
    amount,
    currency,
    customerPhone,
    timestamp,
    rawPayload: body as Record<string, unknown>,
  }
}

function resolveCurrency(body: unknown, mapping: PosFieldMapping): string {
  return String(resolveJsonPath(body, mapping.currency) ?? 'HKD')
}

function resolvePhone(
  body: unknown,
  mapping: PosFieldMapping
): string | null {
  if (!mapping.customerPhone) return null
  const val = resolveJsonPath(body, mapping.customerPhone)
  return val ? String(val) : null
}

function resolveTimestamp(body: unknown, mapping: PosFieldMapping): string {
  if (!mapping.timestamp) return new Date().toISOString()
  return String(resolveJsonPath(body, mapping.timestamp))
}

function verifySignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  const sigHex = signature.startsWith('sha256=') ? signature.slice(7) : signature
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex')
  if (expected.length !== sigHex.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigHex))
}
