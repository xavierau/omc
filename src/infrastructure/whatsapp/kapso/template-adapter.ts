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
  TemplateListItem,
} from '@/domain/ports/whatsapp-templates'
import type { TemplateSubmitResult } from '@/domain/value-objects/template-submit-result'

export const kapsoTemplateAdapter: WhatsAppTemplatePort = {
  async createTemplate(wabaId, params): Promise<TemplateSubmitResult> {
    return createMetaTemplate(wabaId, params)
  },

  async listTemplates(wabaId): Promise<TemplateListItem[] | null> {
    const list = await listMetaTemplates(wabaId)
    if (!list) return null
    return list.map((t) => ({ ...t, id: t.id, name: t.name, status: t.status ?? 'UNKNOWN' }))
  },

  async getTemplate(wabaId, templateId) {
    const tpl = await getMetaTemplate(wabaId, templateId)
    return tpl as Record<string, unknown> | null
  },

  deleteTemplate: deleteMetaTemplate,
  resolveWabaId,
  sendTemplate: sendTemplateMessage,
}
