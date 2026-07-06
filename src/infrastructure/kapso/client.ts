import { WhatsAppClient } from '@kapso/whatsapp-cloud-api'
import type { SendResult } from '@/domain/value-objects/send-result'

const KAPSO_BASE_URL = 'https://api.kapso.ai/meta/whatsapp'

let cachedClient: WhatsAppClient | null = null

function getClient(): WhatsAppClient | null {
  if (cachedClient) return cachedClient

  const kapsoApiKey = process.env.KAPSO_API_KEY
  if (!kapsoApiKey) return null

  cachedClient = new WhatsAppClient({
    kapsoApiKey,
    baseUrl: KAPSO_BASE_URL,
  })
  return cachedClient
}

function skipResult(title: string): SendResult {
  return { ok: false, kapsoMessageId: null, raw: null, error: { title } }
}

function errorResult(err: unknown): SendResult {
  const message = err instanceof Error ? err.message : String(err)
  return {
    ok: false,
    kapsoMessageId: null,
    raw: null,
    error: { title: 'kapso_send_error', details: message },
  }
}

function successFromResponse(raw: unknown): SendResult {
  // SDK shape: { messagingProduct, contacts, messages: [{ id, ... }] }
  const messages = (raw as { messages?: Array<{ id?: string }> } | null)
    ?.messages
  const id = Array.isArray(messages) && messages[0]?.id ? messages[0].id : null
  const rawObj =
    raw && typeof raw === 'object'
      ? (raw as unknown as Record<string, unknown>)
      : null
  if (!id) {
    return {
      ok: false,
      kapsoMessageId: null,
      raw: rawObj,
      error: { title: 'kapso_no_message_id' },
    }
  }
  return { ok: true, kapsoMessageId: id, raw: rawObj }
}

export async function sendTextMessage(
  phoneNumberId: string,
  to: string,
  text: string
): Promise<SendResult> {
  const client = getClient()
  if (!client) {
    console.warn('[Kapso] No API key — message not sent:', { to, text })
    return skipResult('kapso_no_api_key')
  }
  if (!phoneNumberId) {
    console.warn('[Kapso] No phoneNumberId — message not sent:', { to, text })
    return skipResult('kapso_no_phone_number_id')
  }
  try {
    const raw = await client.messages.sendText({
      phoneNumberId,
      to,
      body: text,
    })
    return successFromResponse(raw)
  } catch (err) {
    console.warn('[Kapso] Error sending message:', (err as Error).message)
    return errorResult(err)
  }
}

export async function sendImageMessage(
  phoneNumberId: string,
  to: string,
  imageUrl: string,
  caption?: string
): Promise<SendResult> {
  const client = getClient()
  if (!client) {
    console.warn('[Kapso] No API key — image not sent:', { to, imageUrl })
    return skipResult('kapso_no_api_key')
  }
  if (!phoneNumberId) {
    console.warn('[Kapso] No phoneNumberId — image not sent:', { to, imageUrl })
    return skipResult('kapso_no_phone_number_id')
  }
  try {
    const raw = await client.messages.sendImage({
      phoneNumberId,
      to,
      image: { link: imageUrl, caption },
    })
    return successFromResponse(raw)
  } catch (err) {
    console.warn('[Kapso] Error sending image:', (err as Error).message)
    return errorResult(err)
  }
}

export async function sendInteractiveButtons(
  phoneNumberId: string,
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
  footerText?: string
): Promise<SendResult> {
  const client = getClient()
  if (!client) {
    console.warn('[Kapso] No API key — buttons not sent:', { to, bodyText })
    return skipResult('kapso_no_api_key')
  }
  if (!phoneNumberId) {
    console.warn('[Kapso] No phoneNumberId — buttons not sent:', {
      to,
      bodyText,
    })
    return skipResult('kapso_no_phone_number_id')
  }
  try {
    const raw = await client.messages.sendInteractiveButtons({
      phoneNumberId,
      to,
      bodyText,
      buttons,
      footerText,
    })
    return successFromResponse(raw)
  } catch (err) {
    console.warn('[Kapso] Error sending buttons:', (err as Error).message)
    return errorResult(err)
  }
}

export async function sendInteractiveList(
  phoneNumberId: string,
  to: string,
  bodyText: string,
  buttonText: string,
  sections: Array<{
    title?: string
    rows: Array<{ id: string; title: string; description?: string }>
  }>,
  footerText?: string
): Promise<SendResult> {
  const client = getClient()
  if (!client) {
    console.warn('[Kapso] No API key — list not sent:', { to, bodyText })
    return skipResult('kapso_no_api_key')
  }
  if (!phoneNumberId) {
    console.warn('[Kapso] No phoneNumberId — list not sent:', { to, bodyText })
    return skipResult('kapso_no_phone_number_id')
  }
  try {
    const raw = await client.messages.sendInteractiveList({
      phoneNumberId,
      to,
      bodyText,
      buttonText,
      sections,
      footerText,
    })
    return successFromResponse(raw)
  } catch (err) {
    console.warn('[Kapso] Error sending list:', (err as Error).message)
    return errorResult(err)
  }
}

export async function sendCtaUrlButton(
  phoneNumberId: string,
  to: string,
  bodyText: string,
  displayText: string,
  url: string,
  footerText?: string
): Promise<SendResult> {
  const client = getClient()
  if (!client) {
    console.warn('[Kapso] No API key — CTA url not sent:', { to, bodyText })
    return skipResult('kapso_no_api_key')
  }
  if (!phoneNumberId) {
    console.warn('[Kapso] No phoneNumberId — CTA url not sent:', {
      to,
      bodyText,
    })
    return skipResult('kapso_no_phone_number_id')
  }
  try {
    const raw = await client.messages.sendInteractiveCtaUrl({
      phoneNumberId,
      to,
      bodyText,
      parameters: { displayText, url },
      footerText,
    })
    return successFromResponse(raw)
  } catch (err) {
    console.warn('[Kapso] Error sending CTA url:', (err as Error).message)
    return errorResult(err)
  }
}
