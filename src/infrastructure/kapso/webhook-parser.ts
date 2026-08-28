import crypto from 'crypto'
import { maskPhone } from '@/infrastructure/logging/logger'

type LogFn = (level: 'info' | 'warn' | 'error', event: string, data: unknown) => void
const noop: LogFn = () => {}

export interface KapsoMessage {
  messageId: string
  from: string
  type: 'text' | 'image' | 'interactive' | 'button' | 'unknown'
  text?: string
  imageUrl?: string
  imageId?: string
  timestamp: string
  contactName?: string
  // WhatsApp Flow submission (interactive.type === 'nfm_reply'). See AD-7:
  // raw response_json is the reliable contract; kapso.* extension fields are
  // an optimisation-only fallback (REPLY-005 plan, Open Question Q1).
  flowResponse?: Record<string, unknown>
  flowToken?: string
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
  // Message-shaped events without a usable sender (Kapso status/echo events,
  // or garbage like a numeric `from`) are a different category — routing them
  // as inbound throws downstream and turns into a provider retry storm
  // (issue #45). Ignore them. Must be a string: a non-string would already
  // throw in this module's masked logging before any route-level guard.
  if (typeof msg.from !== 'string' || msg.from.trim() === '') return null

  const textContent = msg.text as Record<string, string> | string | undefined
  const { flowResponse, flowToken } = extractFlowSubmission(msg.interactive, msg.kapso)

  return {
    messageId: (msg.id as string) ?? fallbackId,
    from: msg.from,
    type: resolveMessageType(msg.type as string),
    text: extractText(textContent)
      ?? extractInteractiveText(msg.interactive)
      ?? extractButtonPayload(msg.button),
    imageUrl: extractImageUrl(msg.image),
    imageId: extractImageId(msg.image),
    timestamp: (msg.timestamp as string) ?? new Date().toISOString(),
    contactName,
    flowResponse,
    flowToken,
  }
}

function resolveMessageType(
  type: string | undefined
): KapsoMessage['type'] {
  if (type === 'image') return 'image'
  if (type === 'text') return 'text'
  if (type === 'interactive') return 'interactive'
  if (type === 'button') return 'button'
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

function extractButtonPayload(button: unknown): string | undefined {
  if (!button || typeof button !== 'object') return undefined
  const b = button as Record<string, unknown>
  return typeof b.payload === 'string' ? b.payload : undefined
}

// WhatsApp Flow submission (AD-7, REPLY-005). The raw `response_json` string
// on `interactive.nfm_reply` is the reliable contract per Meta; this must
// never throw on malformed/unexpected payloads (webhook hot path — see the
// comments at src/app/api/webhooks/whatsapp/route.ts:90-94). Kapso's
// pre-parsed `kapso.flow_response` / `kapso.flow_token` extension fields
// (unverified whether this app's subscription requests them — plan Open
// Question Q1) are used only as a fallback when the raw path yields nothing.
//
// `hasNfmReplySignal` is the SINGLE gate for both paths (code review H1):
// without it, `kapso.flow_response` was accepted on ANY interactive message
// (including `{}`), so a stray Kapso field on a button/list reply would
// hijack it into the flow-submission handler app-wide. Requiring the same
// nfm_reply signal the raw path already needs, plus a non-empty object,
// closes that.
function extractFlowSubmission(
  interactive: unknown,
  kapso: unknown
): { flowResponse?: Record<string, unknown>; flowToken?: string } {
  if (!hasNfmReplySignal(interactive)) return {}

  const flowResponse = parseNfmResponseJson(interactive) ?? extractKapsoFlowResponse(kapso)
  const flowToken = extractFlowTokenFromResponse(flowResponse) ?? extractKapsoFlowToken(kapso)
  return { flowResponse, flowToken }
}

function hasNfmReplySignal(interactive: unknown): boolean {
  if (!interactive || typeof interactive !== 'object') return false
  const obj = interactive as Record<string, unknown>
  const nfmReply = obj.nfm_reply as Record<string, unknown> | undefined
  return obj.type === 'nfm_reply' || !!nfmReply
}

function parseNfmResponseJson(interactive: unknown): Record<string, unknown> | undefined {
  const obj = interactive as Record<string, unknown>
  const nfmReply = obj.nfm_reply as Record<string, unknown> | undefined
  const responseJson = nfmReply?.response_json
  if (typeof responseJson !== 'string') return undefined

  try {
    const parsed: unknown = JSON.parse(responseJson)
    return isNonEmptyPlainObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function extractKapsoFlowResponse(kapso: unknown): Record<string, unknown> | undefined {
  if (!kapso || typeof kapso !== 'object') return undefined
  const flowResponse = (kapso as Record<string, unknown>).flow_response
  return isNonEmptyPlainObject(flowResponse) ? flowResponse : undefined
}

function extractFlowTokenFromResponse(
  flowResponse: Record<string, unknown> | undefined
): string | undefined {
  const token = flowResponse?.flow_token
  return typeof token === 'string' ? token : undefined
}

function extractKapsoFlowToken(kapso: unknown): string | undefined {
  if (!kapso || typeof kapso !== 'object') return undefined
  const token = (kapso as Record<string, unknown>).flow_token
  return typeof token === 'string' ? token : undefined
}

// Non-empty: `{}` must not be treated as a flow submission — see H1 above.
function isNonEmptyPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  )
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

  // Compare byte lengths, not string lengths: a multi-byte char with matching
  // string length would make timingSafeEqual throw → an unauthenticated 500.
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return false

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )
}
