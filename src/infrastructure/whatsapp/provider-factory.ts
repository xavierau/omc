import { kapsoMessagingAdapter } from './kapso/messaging-adapter'
import { kapsoTemplateAdapter } from './kapso/template-adapter'
import { kapsoWebhookAdapter } from './kapso/webhook-adapter'
import type { WhatsAppMessagingPort } from '@/domain/ports/whatsapp-messaging'
import type { WhatsAppTemplatePort } from '@/domain/ports/whatsapp-templates'
import type { WhatsAppWebhookPort } from '@/domain/ports/whatsapp-webhooks'

let messagingInstance: WhatsAppMessagingPort | null = null
let templateInstance: WhatsAppTemplatePort | null = null
let webhookInstance: WhatsAppWebhookPort | null = null

const KNOWN_PROVIDERS = new Set(['kapso'])

function getProvider(): string {
  const provider = process.env.WHATSAPP_PROVIDER ?? 'kapso'
  if (!KNOWN_PROVIDERS.has(provider)) {
    throw new Error(`Unknown WhatsApp provider: "${provider}". Valid: ${[...KNOWN_PROVIDERS].join(', ')}`)
  }
  return provider
}

function createMessaging(provider: string): WhatsAppMessagingPort {
  if (provider === 'kapso') return kapsoMessagingAdapter
  throw new Error(`No messaging adapter for provider: ${provider}`)
}

function createTemplates(provider: string): WhatsAppTemplatePort {
  if (provider === 'kapso') return kapsoTemplateAdapter
  throw new Error(`No template adapter for provider: ${provider}`)
}

function createWebhooks(provider: string): WhatsAppWebhookPort {
  if (provider === 'kapso') return kapsoWebhookAdapter
  throw new Error(`No webhook adapter for provider: ${provider}`)
}

export function getMessagingProvider(): WhatsAppMessagingPort {
  if (!messagingInstance) messagingInstance = createMessaging(getProvider())
  return messagingInstance
}

export function getTemplateProvider(): WhatsAppTemplatePort {
  if (!templateInstance) templateInstance = createTemplates(getProvider())
  return templateInstance
}

export function getWebhookProvider(): WhatsAppWebhookPort {
  if (!webhookInstance) webhookInstance = createWebhooks(getProvider())
  return webhookInstance
}

export function _resetProviders(): void {
  messagingInstance = null
  templateInstance = null
  webhookInstance = null
}
