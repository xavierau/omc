import type { PosWebhookPort } from '@/domain/ports/pos-webhook'
import type { PosApiPort } from '@/domain/ports/pos-api'
import type { PosProvider } from '@/domain/entities/pos-integration'
import { createGenericWebhookAdapter } from './generic/webhook-adapter'
import { createGenericApiAdapter } from './generic/api-adapter'

interface PosProviderAdapters {
  webhook: PosWebhookPort
  api: PosApiPort
}

const KNOWN_PROVIDERS = new Set<PosProvider>([
  'generic',
  'ichef',
  'square',
])

export function createPosProvider(
  provider: PosProvider
): PosProviderAdapters {
  if (!KNOWN_PROVIDERS.has(provider)) {
    throw new Error(
      `Unknown POS provider: "${provider}". Valid: ${[...KNOWN_PROVIDERS].join(', ')}`
    )
  }
  return {
    webhook: createWebhookAdapter(provider),
    api: createApiAdapter(provider),
  }
}

function createWebhookAdapter(provider: PosProvider): PosWebhookPort {
  switch (provider) {
    case 'generic':
      return createGenericWebhookAdapter()
    default:
      throw new Error(`No webhook adapter for POS provider: ${provider}`)
  }
}

function createApiAdapter(provider: PosProvider): PosApiPort {
  switch (provider) {
    case 'generic':
      return createGenericApiAdapter()
    default:
      throw new Error(`No API adapter for POS provider: ${provider}`)
  }
}
