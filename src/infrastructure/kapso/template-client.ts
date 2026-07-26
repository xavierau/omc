import {
  GraphApiError,
  type MessageTemplate,
  WhatsAppClient,
  buildTemplateSendPayload,
} from '@kapso/whatsapp-cloud-api'
import type { SendResult } from '@/domain/value-objects/send-result'
import type { TemplateSubmitResult } from '@/domain/value-objects/template-submit-result'

const KAPSO_BASE_URL = 'https://api.kapso.ai/meta/whatsapp'

// Kapso's own platform API, NOT the Meta proxy above. `whatsapp_configs` is
// the only endpoint that maps a phone number id to its parent WABA — see
// `resolveWabaId` for why the Graph API can't do this.
const KAPSO_APP_BASE_URL = 'https://app.kapso.ai/api/v1'

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

/** Meta's own words, plus the codes that identify the rejection class. */
function describeGraphError(err: GraphApiError): string {
  const subcode =
    err.errorSubcode !== undefined ? `, subcode ${err.errorSubcode}` : ''
  return `${err.message} (code ${err.code}${subcode})`
}

export async function createMetaTemplate(
  businessAccountId: string,
  params: {
    name: string
    language: string
    category: string
    components: Array<{ type: string; [k: string]: unknown }>
    parameterFormat?: 'NAMED' | 'POSITIONAL'
  }
): Promise<TemplateSubmitResult> {
  const client = getClient()
  if (!client) {
    return {
      ok: false,
      templateId: null,
      status: null,
      error: { title: 'kapso_no_api_key' },
    }
  }

  try {
    const res = await client.templates.create({
      businessAccountId,
      ...params,
    })
    return { ok: true, templateId: res.id, status: res.status }
  } catch (err) {
    console.warn('[Kapso] Error creating template:', (err as Error).message, JSON.stringify(err, null, 2))
    if (err instanceof GraphApiError) {
      return {
        ok: false,
        templateId: null,
        status: null,
        error: { title: 'meta_rejected', details: describeGraphError(err) },
      }
    }
    return {
      ok: false,
      templateId: null,
      status: null,
      error: {
        title: 'template_create_error',
        details: err instanceof Error ? err.message : String(err),
      },
    }
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

/** One page of `GET /api/v1/whatsapp_configs`; only the two fields we need. */
type WhatsAppConfigsPage = {
  data?: Array<{ phone_number_id?: string; business_account_id?: string }>
  meta?: { page?: number; total_pages?: number }
}

// Kapso caps `per_page`; 100 is accepted and keeps the common single-tenant
// lookup to exactly one request. `MAX_PAGES` is a runaway guard, not a real
// bound — a deployment with more than 5000 numbers on one API key would need
// a filtered endpoint anyway.
const CONFIGS_PAGE_SIZE = 100
const CONFIGS_MAX_PAGES = 50

/**
 * Derive a phone number's parent WABA id.
 *
 * Uses Kapso's platform API rather than the Graph API. The obvious Graph call
 * — `GET /{phoneNumberId}?fields=account` — is what this function used to do,
 * and Meta rejects it outright on every version v19.0–v23.0:
 *
 *   HTTP 400  (#100) Tried accessing nonexisting field (account)
 *
 * The phone-number node exposes no parent-WABA field at all (`account` and
 * `whatsapp_business_account` are both rejected), so the old implementation
 * could only ever return `null`. That failure was invisible: the SDK's
 * `request()` does not throw on 4xx, so `res.json()` parsed the *error* body
 * cleanly and `data.account?.id` was simply `undefined`. Nothing reached the
 * logs, and the contact-Flow deploy path — which is derive-only by design and
 * has no stored fallback — failed permanently with `contact_flow.no_waba_id`
 * (issue #74). Template creation masked the bug by preferring the stored
 * `meta_business_account_id` and treating this as a fallback only.
 *
 * `whatsapp_configs` has no server-side filter (a `phone_number_id` query
 * param is silently ignored), so we page and match client-side. Returning
 * `null` still means "could not derive" for every caller; the difference is
 * that each distinct reason is now logged.
 */
export async function resolveWabaId(
  phoneNumberId: string
): Promise<string | null> {
  const client = getClient()
  if (!client) return null
  if (!phoneNumberId) return null

  try {
    for (let page = 1; page <= CONFIGS_MAX_PAGES; page++) {
      const res = await client.fetch(
        `${KAPSO_APP_BASE_URL}/whatsapp_configs?page=${page}&per_page=${CONFIGS_PAGE_SIZE}`
      )
      if (!res.ok) {
        // Fail loudly-in-logs: an HTTP error must never look like "this
        // number has no WABA", which is the trap the old version fell into.
        console.warn(
          `[Kapso] Error resolving WABA ID: whatsapp_configs returned ${res.status}`,
          await readErrorBody(res)
        )
        return null
      }

      const body = (await res.json()) as WhatsAppConfigsPage
      const configs = body.data ?? []
      if (configs.length === 0) break

      const match = configs.find((c) => c.phone_number_id === phoneNumberId)
      if (match?.business_account_id) return match.business_account_id

      const totalPages = body.meta?.total_pages
      if (typeof totalPages === 'number' && page >= totalPages) break
    }

    console.warn(
      `[Kapso] Error resolving WABA ID: no whatsapp_config for phone number ${phoneNumberId}`
    )
    return null
  } catch (err) {
    console.warn('[Kapso] Error resolving WABA ID:', (err as Error).message)
    return null
  }
}

/** Best-effort error body for the log line — never throws over a log. */
async function readErrorBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return '<unreadable body>'
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
    buttons?: Array<
      | {
          type: 'button'
          subType: 'url'
          index: number | string
          parameters: Array<{ type: 'text'; text: string }>
        }
      | {
          type: 'button'
          subType: 'quick_reply'
          index: number | string
          parameters: Array<{ type: 'payload'; payload: string }>
        }
    >
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
