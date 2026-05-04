import {
  isTemplateSendable,
  extractParameters,
} from '@/domain/entities/whatsapp-template'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { sendTemplateMessage } from '@/infrastructure/whatsapp/templates'
import type { SendResult } from '@/domain/value-objects/send-result'

interface SendParams {
  phoneNumberId: string
  to: string
  template: WhatsAppTemplate
  paramValues: Record<string, string>
  couponCode?: string
}

export async function sendWhatsAppTemplateMessage(
  params: SendParams
): Promise<SendResult> {
  if (!isTemplateSendable(params.template)) {
    throw new Error('Template is not approved for sending')
  }

  const paramNames = extractParameters(params.template)
  const bodyParams = paramNames.map((name) => ({
    type: 'text' as const,
    text: params.paramValues[name] ?? '',
    parameterName: name,
  }))

  const buttons = buildUrlButtonParams(
    params.template,
    params.couponCode
  )

  return sendTemplateMessage(params.phoneNumberId, params.to, {
    templateName: params.template.name,
    language: params.template.language,
    bodyParams,
    buttons,
  })
}

type UrlButtonParam = {
  type: 'button'
  subType: 'url'
  index: number
  parameters: Array<{ type: 'text'; text: string }>
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
