import {
  isTemplateSendable,
  extractParameters,
} from '@/domain/entities/whatsapp-template'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import {
  isMediaHeader,
  readHeaderLink,
} from '@/domain/services/template-media-header'
import { enforceHeaderMedia } from './enforce-header-media'
import { sendTemplateMessage } from '@/infrastructure/whatsapp/templates'
import type {
  TemplateButtonParam,
  TemplateHeaderParam,
} from '@/domain/ports/whatsapp-templates'
import type { SendResult } from '@/domain/value-objects/send-result'

interface SendParams {
  phoneNumberId: string
  to: string
  template: WhatsAppTemplate
  paramValues: Record<string, string>
  couponCode?: string
  // CAMP-001: claim-mode quick-reply payload (`CLAIM_<campaignId>`). Emitted
  // at the template's first QUICK_REPLY button index. Mutually exclusive with
  // `couponCode` in practice.
  claimPayload?: string
}

export async function sendWhatsAppTemplateMessage(
  params: SendParams
): Promise<SendResult> {
  if (!isTemplateSendable(params.template)) {
    throw new Error('Template is not approved for sending')
  }
  // #127 / CAMP-007: refuse to send a payload Meta is guaranteed to reject
  // (#132012) — a media header we cannot supply must fail loudly here, not
  // as an opaque kapso_send_error per recipient.
  enforceHeaderMedia(params.template)

  const paramNames = extractParameters(params.template)
  const bodyParams = paramNames.map((name) => ({
    type: 'text' as const,
    text: params.paramValues[name] ?? '',
    parameterName: name,
  }))

  return sendTemplateMessage(params.phoneNumberId, params.to, {
    templateName: params.template.name,
    language: params.template.language,
    bodyParams,
    headerParams: buildHeaderParams(params.template),
    buttons: buildButtonParams(params),
  })
}

// #127 / CAMP-007: a template declaring a media HEADER must carry a matching
// send-time header parameter. The link is the template row's own stored
// header URL (campaign image_url_* is welcome-only and never reaches this
// path). enforceHeaderMedia above already threw when no link is resolvable.
function buildHeaderParams(
  template: WhatsAppTemplate
): TemplateHeaderParam[] | undefined {
  const header = template.components.find(isMediaHeader)
  if (!header) return undefined
  const link = readHeaderLink(header)
  if (link === null) return undefined
  switch (header.format) {
    case 'VIDEO':
      return [{ type: 'video', video: { link } }]
    case 'DOCUMENT':
      return [{ type: 'document', document: { link } }]
    default:
      return [{ type: 'image', image: { link } }]
  }
}

function buildButtonParams(
  params: SendParams
): TemplateButtonParam[] | undefined {
  const url = buildUrlButtonParams(params.template, params.couponCode)
  const quickReply = buildQuickReplyButtonParams(
    params.template,
    params.claimPayload
  )
  const merged = [...(url ?? []), ...(quickReply ?? [])]
  return merged.length > 0 ? merged : undefined
}

type UrlButtonParam = {
  type: 'button'
  subType: 'url'
  index: number
  parameters: Array<{ type: 'text'; text: string }>
}

type QuickReplyButtonParam = {
  type: 'button'
  subType: 'quick_reply'
  index: number
  parameters: Array<{ type: 'payload'; payload: string }>
}

function buildQuickReplyButtonParams(
  template: WhatsAppTemplate,
  claimPayload?: string
): QuickReplyButtonParam[] | undefined {
  if (!claimPayload) return undefined

  const buttonsComponent = template.components.find((c) => c.type === 'BUTTONS')
  const index =
    buttonsComponent?.buttons?.findIndex((b) => b.type === 'QUICK_REPLY') ?? -1
  if (index < 0) return undefined

  return [
    {
      type: 'button',
      subType: 'quick_reply',
      index,
      parameters: [{ type: 'payload', payload: claimPayload }],
    },
  ]
}

function buildUrlButtonParams(
  template: WhatsAppTemplate,
  couponCode?: string
): UrlButtonParam[] | undefined {
  if (!couponCode) return undefined

  const buttonsComponent = template.components.find(
    (c) => c.type === 'BUTTONS'
  )
  if (!buttonsComponent?.buttons) return undefined

  const urlButtons: UrlButtonParam[] = []

  buttonsComponent.buttons.forEach((btn, index) => {
    if (btn.type === 'URL' && btn.url?.includes('{{1}}')) {
      urlButtons.push({
        type: 'button',
        subType: 'url',
        index,
        parameters: [{ type: 'text', text: couponCode }],
      })
    }
  })

  return urlButtons.length > 0 ? urlButtons : undefined
}
