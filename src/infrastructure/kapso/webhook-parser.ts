import crypto from 'crypto'
import { maskPhone } from '@/infrastructure/logging/logger'

type LogFn = (level: 'info' | 'warn' | 'error', event: string, data: unknown) => void
const noop: LogFn = () => {}

export interface KapsoMessage {
  messageId: string
  from: string
  type: 'text' | 'image' | 'interactive' | 'unknown'
  text?: string
  imageUrl?: string
  imageId?: string
  timestamp: string
  contactName?: string
}

export function parseKapsoWebhook(
  body: unknown,
  headers?: Record<string, string | undefined>,
  log: LogFn = noop
): KapsoMessage | null {
  const payload = body as Record<string, unknown>
  if (!payload) return null

  const format = isMetaFormat(payload) ? 'meta-cloud-api' : 'kapso'
  log('info', 'parser.format', { format })

  const message = format === 'meta-cloud-api'
    ? parseMetaWebhook(payload, headers)
    : parseKapsoFormat(payload)

  if (message) {
    log('info', 'parser.result', {
      messageId: message.messageId,
      type: message.type,
      from: maskPhone(message.from),
      contactName: message.contactName ?? null,
    })
  }

  return message
}

function isMetaFormat(payload: Record<string, unknown>): boolean {
  return payload.object === 'whatsapp_business_account'
}

function parseMetaWebhook(
  payload: Record<string, unknown>,
  headers?: Record<string, string | undefined>
): KapsoMessage | null {
  const entry = (payload.entry as Array<Record<string, unknown>>)?.[0]
  const changes = (entry?.changes as Array<Record<string, unknown>>)?.[0]
  const value = changes?.value as Record<string, unknown> | undefined
  const messages = (value?.messages as Array<Record<string, unknown>>)?.[0]

  if (!messages) return null

  const idempotencyKey = headers?.['x-idempotency-key']
  const fallbackId = idempotencyKey ?? crypto.randomUUID()
  const contacts = (value?.contacts as Array<Record<string, unknown>>)?.[0]
  const contactName = extractContactName(contacts)

  return buildMessage(messages, fallbackId, contactName)
}

function parseKapsoFormat(
  payload: Record<string, unknown>
): KapsoMessage | null {
  if (!payload.message) return null

  const msg = payload.message as Record<string, unknown>
  const fallbackId = (msg.id as string) ?? crypto.randomUUID()
  const conversation = payload.conversation as Record<string, unknown> | undefined
  const contactName = (conversation?.contact_name as string) ?? undefined

  return buildMessage(msg, fallbackId, contactName)
}

function buildMessage(
  msg: Record<string, unknown>,
  fallbackId: string,
  contactName?: string
): KapsoMessage | null {
  // Message-shaped events without a sender (Kapso status/echo events) are a
  // different category — routing them as inbound throws on the empty phone
  // and turns into a provider retry storm (issue #45). Ignore them.
  if (!msg.from) return null

  const textContent = msg.text as Record<string, string> | string | undefined

  return {
    messageId: (msg.id as string) ?? fallbackId,
    from: msg.from as string,
    type: resolveMessageType(msg.type as string),
    text: extractText(textContent) ?? extractInteractiveText(msg.interactive),
    imageUrl: extractImageUrl(msg.image),
    imageId: extractImageId(msg.image),
    timestamp: (msg.timestamp as string) ?? new Date().toISOString(),
    contactName,
  }
}

function resolveMessageType(
  type: string | undefined
): KapsoMessage['type'] {
  if (type === 'image') return 'image'
  if (type === 'text') return 'text'
  if (type === 'interactive') return 'interactive'
  return 'unknown'
}

function extractText(
  text: Record<string, string> | string | undefined
): string | undefined {
  if (typeof text === 'string') return text
  if (text && typeof text === 'object') return text.body
  return undefined
}

function extractContactName(
  contact: Record<string, unknown> | undefined
): string | undefined {
  if (!contact) return undefined
  const profile = contact.profile as Record<string, unknown> | undefined
  return (profile?.name as string) ?? undefined
}

function extractInteractiveText(
  interactive: unknown
): string | undefined {
  if (!interactive || typeof interactive !== 'object') return undefined
  const obj = interactive as Record<string, unknown>
  const buttonReply = obj.button_reply as Record<string, unknown> | undefined
  if (buttonReply?.id) return buttonReply.id as string
  const listReply = obj.list_reply as Record<string, unknown> | undefined
  if (listReply?.id) return listReply.id as string
  return undefined
}

function extractImageUrl(image: unknown): string | undefined {
  if (!image || typeof image !== 'object') return undefined
  const img = image as Record<string, unknown>
  if ('url' in img) return img.url as string
  if ('link' in img) return img.link as string
  return undefined
}

function extractImageId(image: unknown): string | undefined {
  if (!image || typeof image !== 'object') return undefined
  const img = image as Record<string, unknown>
  return (img.id as string) ?? undefined
}

export function verifyKapsoSignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex')

  if (signature.length !== expected.length) return false

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )
}
