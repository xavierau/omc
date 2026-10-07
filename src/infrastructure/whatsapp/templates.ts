import { getTemplateProvider } from './provider-factory'
import type {
  TemplateComponent,
  TemplateBodyParam,
  TemplateHeaderParam,
  TemplateButtonParam,
  TemplateListItem,
} from '@/domain/ports/whatsapp-templates'

export type MetaTemplateListItem = TemplateListItem

export function createMetaTemplate(
  wabaId: string,
  params: {
    name: string
    language: string
    category: string
    components: TemplateComponent[]
    parameterFormat?: 'NAMED' | 'POSITIONAL'
  }
) {
  return getTemplateProvider().createTemplate(wabaId, params)
}

export function listMetaTemplates(wabaId: string) {
  return getTemplateProvider().listTemplates(wabaId)
}

export function getMetaTemplate(
  wabaId: string,
  templateId: string
) {
  return getTemplateProvider().getTemplate(wabaId, templateId)
}

export function deleteMetaTemplate(
  wabaId: string,
  templateName: string
) {
  return getTemplateProvider().deleteTemplate(wabaId, templateName)
}

export function resolveWabaId(phoneNumberId: string) {
  return getTemplateProvider().resolveWabaId(phoneNumberId)
}

export function sendTemplateMessage(
  phoneNumberId: string,
  to: string,
  params: {
    templateName: string
    language: string
    bodyParams?: TemplateBodyParam[]
    headerParams?: TemplateHeaderParam[]
    buttons?: TemplateButtonParam[]
  }
) {
  return getTemplateProvider().sendTemplate(
    phoneNumberId, to, params
  )
}
