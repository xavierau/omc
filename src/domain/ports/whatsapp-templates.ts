import type { SendResult } from '@/domain/value-objects/send-result'
import type { TemplateSubmitResult } from '@/domain/value-objects/template-submit-result'

export interface TemplateComponent { type: string; [k: string]: unknown }
export interface TemplateBodyParam { type: 'text'; text: string; parameterName: string }
// #127 / CAMP-007: media variants carry `link` only — a stored `4:` upload
// handle is a template-creation artifact, not a send-time media id, so a
// public URL is the only source the send path can legally pass to Meta.
export type TemplateHeaderParam =
  | { type: 'text'; text: string; parameterName?: string }
  | { type: 'image'; image: { link: string } }
  | { type: 'video'; video: { link: string } }
  | { type: 'document'; document: { link: string } }
export type TemplateButtonParam =
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
export interface TemplateListItem { id: string; name: string; status: string; [k: string]: unknown }

export interface WhatsAppTemplatePort {
  createTemplate(wabaId: string, params: {
    name: string
    language: string
    category: string
    components: TemplateComponent[]
    parameterFormat?: 'NAMED' | 'POSITIONAL'
  }): Promise<TemplateSubmitResult>

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
