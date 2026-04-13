import {
  createMetaTemplate,
  listMetaTemplates,
  getMetaTemplate,
  deleteMetaTemplate,
  resolveWabaId,
  sendTemplateMessage,
} from '@/infrastructure/kapso/template-client'
import type {
  WhatsAppTemplatePort,
  CreateTemplateResult,
  TemplateListItem,
} from '@/domain/ports/whatsapp-templates'

export const kapsoTemplateAdapter: WhatsAppTemplatePort = {
  async createTemplate(wabaId, params): Promise<CreateTemplateResult | null> {
    const result = await createMetaTemplate(wabaId, params)
    if (!result) return null
    return { id: result.id, status: result.status }
  },

  async listTemplates(wabaId): Promise<TemplateListItem[] | null> {
    const list = await listMetaTemplates(wabaId)
    if (!list) return null
    return list.map((t) => ({ ...t }) as TemplateListItem)
  },

  async getTemplate(wabaId, templateId) {
    const tpl = await getMetaTemplate(wabaId, templateId)
    return tpl as Record<string, unknown> | null
  },

  deleteTemplate: deleteMetaTemplate,
  resolveWabaId,
  sendTemplate: sendTemplateMessage,
}
