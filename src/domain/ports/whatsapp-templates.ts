import type { SendResult } from '@/infrastructure/whatsapp/messaging-result'

export interface TemplateComponent { type: string; [k: string]: unknown }
export interface TemplateBodyParam { type: 'text'; text: string; parameterName: string }
export interface TemplateHeaderParam { type: 'text'; text: string; parameterName?: string }
export interface TemplateButtonParam {
  type: 'button'
  subType: 'url'
  index: number | string
  parameters: Array<{ type: 'text'; text: string }>
}
export interface CreateTemplateResult { id: string; status: string }
export interface TemplateListItem { id: string; name: string; status: string; [k: string]: unknown }

export interface WhatsAppTemplatePort {
  createTemplate(wabaId: string, params: {
    name: string
    language: string
    category: string
    components: TemplateComponent[]
    parameterFormat?: 'NAMED' | 'POSITIONAL'
  }): Promise<CreateTemplateResult | null>

  listTemplates(wabaId: string): Promise<TemplateListItem[] | null>
  getTemplate(wabaId: string, templateId: string): Promise<Record<string, unknown> | null>
  deleteTemplate(wabaId: string, templateName: string): Promise<boolean>
  resolveWabaId(phoneNumberId: string): Promise<string | null>

  sendTemplate(phoneNumberId: string, to: string, params: {
    templateName: string
    language: string
    bodyParams?: TemplateBodyParam[]
    headerParams?: TemplateHeaderParam[]
    buttons?: TemplateButtonParam[]
  }): Promise<SendResult>
}
