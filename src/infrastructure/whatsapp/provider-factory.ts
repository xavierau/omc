import { kapsoMessagingAdapter } from './kapso/messaging-adapter'
import { kapsoTemplateAdapter } from './kapso/template-adapter'
import { kapsoWebhookAdapter } from './kapso/webhook-adapter'
import type { WhatsAppMessagingPort } from '@/domain/ports/whatsapp-messaging'
import type { WhatsAppTemplatePort } from '@/domain/ports/whatsapp-templates'
import type { WhatsAppWebhookPort } from '@/domain/ports/whatsapp-webhooks'

let messagingInstance: WhatsAppMessagingPort | null = null
let templateInstance: WhatsAppTemplatePort | null = null
let webhookInstance: WhatsAppWebhookPort | null = null

function getProvider(): string {
  return process.env.WHATSAPP_PROVIDER ?? 'kapso'
}

function createMessaging(provider: string): WhatsAppMessagingPort {
  if (provider === 'kapso') return kapsoMessagingAdapter
  throw new Error(`Unknown WhatsApp provider: ${provider}`)
}

function createTemplates(provider: string): WhatsAppTemplatePort {
  if (provider === 'kapso') return kapsoTemplateAdapter
  throw new Error(`Unknown WhatsApp provider: ${provider}`)
}

function createWebhooks(provider: string): WhatsAppWebhookPort {
  if (provider === 'kapso') return kapsoWebhookAdapter
  throw new Error(`Unknown WhatsApp provider: ${provider}`)
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
