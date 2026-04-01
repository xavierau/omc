import {
  findTemplateById,
  softDeleteTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { getMetaBusinessAccountId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { deleteMetaTemplate } from '@/infrastructure/kapso/template-client'

interface DeleteResult {
  success: boolean
  error?: string
}

export async function deleteWhatsAppTemplate(
  templateId: string
): Promise<DeleteResult> {
  const template = await findTemplateById(templateId)
  if (!template) {
    return { success: false, error: 'Template not found' }
  }

  if (template.metaTemplateId) {
    await deleteFromMeta(template.restaurantId, template.name)
  }

  await softDeleteTemplate(templateId)
  return { success: true }
}

async function deleteFromMeta(
  restaurantId: string,
  templateName: string
): Promise<void> {
  const businessAccountId = await getMetaBusinessAccountId(restaurantId)
  if (!businessAccountId) return

  const deleted = await deleteMetaTemplate(businessAccountId, templateName)
  if (!deleted) {
    console.warn(`[Template] Failed to delete "${templateName}" from Meta`)
  }
}
