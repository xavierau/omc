import { createPosProvider } from './provider-factory'
import type { PosWebhookEvent } from '@/domain/ports/pos-webhook'
import type { PosFieldMapping } from '@/domain/value-objects/pos-field-mapping'
import type { PosProvider } from '@/domain/entities/pos-integration'

export type { PosWebhookEvent }

export function parsePosWebhook(
  provider: PosProvider,
  body: unknown,
  mapping?: PosFieldMapping
): PosWebhookEvent | null {
  return createPosProvider(provider).webhook.parse(body, mapping)
}

export function verifyPosSignature(
  provider: PosProvider,
  body: string,
  signature: string,
  secret: string
): boolean {
  return createPosProvider(provider).webhook.verifySignature(
    body,
    signature,
    secret
  )
}
