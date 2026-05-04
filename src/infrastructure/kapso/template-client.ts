import {
  type MessageTemplate,
  type TemplateCreateResponse,
  WhatsAppClient,
  buildTemplateSendPayload,
} from '@kapso/whatsapp-cloud-api'
import type { SendResult } from '@/infrastructure/whatsapp/messaging-result'

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

export type MetaTemplateListItem = MessageTemplate

export async function createMetaTemplate(
  businessAccountId: string,
  params: {
    name: string
    language: string
    category: string
    components: Array<{ type: string; [k: string]: unknown }>
    parameterFormat?: 'NAMED' | 'POSITIONAL'
  }
): Promise<TemplateCreateResponse | null> {
  const client = getClient()
  if (!client) return null

  try {
    return await client.templates.create({
      businessAccountId,
      ...params,
    })
  } catch (err) {
    console.warn('[Kapso] Error creating template:', (err as Error).message, JSON.stringify(err, null, 2))
    return null
  }
}

export async function listMetaTemplates(
  businessAccountId: string
): Promise<MetaTemplateListItem[] | null> {
  const client = getClient()
  if (!client) return null

  try {
    const res = await client.templates.list({ businessAccountId })
    return res.data
  } catch (err) {
    console.warn('[Kapso] Error listing templates:', (err as Error).message)
    return null
  }
}

export async function getMetaTemplate(
  businessAccountId: string,
  templateId: string
): Promise<MessageTemplate | null> {
  const client = getClient()
  if (!client) return null

  try {
    return await client.templates.get({ businessAccountId, templateId })
  } catch (err) {
    console.warn('[Kapso] Error getting template:', (err as Error).message)
    return null
  }
}

export async function deleteMetaTemplate(
  businessAccountId: string,
  templateName: string
): Promise<boolean> {
  const client = getClient()
  if (!client) return false

  try {
    await client.templates.delete({
      businessAccountId,
      name: templateName,
    })
    return true
  } catch (err) {
    console.warn('[Kapso] Error deleting template:', (err as Error).message)
    return false
  }
}

export async function resolveWabaId(
  phoneNumberId: string
): Promise<string | null> {
  const client = getClient()
  if (!client) return null
  if (!phoneNumberId) return null

  try {
    const res = await client.request(
      'GET',
      `/${phoneNumberId}?fields=account`
    )
    const data = (await res.json()) as { account?: { id?: string } }
    return data.account?.id ?? null
  } catch (err) {
    console.warn('[Kapso] Error resolving WABA ID:', (err as Error).message)
    return null
  }
}

export async function sendTemplateMessage(
  phoneNumberId: string,
  to: string,
  params: {
    templateName: string
    language: string
    bodyParams?: Array<{ type: 'text'; text: string; parameterName: string }>
    headerParams?: Array<{ type: 'text'; text: string; parameterName?: string }>
    buttons?: Array<{
      type: 'button'
      subType: 'url'
      index: number | string
      parameters: Array<{ type: 'text'; text: string }>
    }>
  }
): Promise<SendResult> {
  const client = getClient()
  if (!client) {
    return {
      ok: false,
      kapsoMessageId: null,
      raw: null,
      error: { title: 'kapso_no_api_key' },
    }
  }
  if (!phoneNumberId) {
    return {
      ok: false,
      kapsoMessageId: null,
      raw: null,
      error: { title: 'kapso_no_phone_number_id' },
    }
  }

  try {
    const payload = buildTemplateSendPayload({
      name: params.templateName,
      language: params.language,
      body: params.bodyParams,
      header: params.headerParams?.[0],
      buttons: params.buttons,
    })

    const raw = await client.messages.sendTemplate({
      phoneNumberId,
      to,
      template: payload,
    })
    const messages = (raw as { messages?: Array<{ id?: string }> } | null)
      ?.messages
    const id =
      Array.isArray(messages) && messages[0]?.id ? messages[0].id : null
    if (!id) {
      return {
        ok: false,
        kapsoMessageId: null,
        raw: (raw as unknown as Record<string, unknown>) ?? null,
        error: { title: 'kapso_no_message_id' },
      }
    }
    return {
      ok: true,
      kapsoMessageId: id,
      raw: (raw as unknown as Record<string, unknown>) ?? null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[Kapso] Error sending template:', message)
    return {
      ok: false,
      kapsoMessageId: null,
      raw: null,
      error: { title: 'kapso_send_error', details: message },
    }
  }
}
