import {
  findTemplateByIdForRestaurant,
  softDeleteTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { getMetaBusinessAccountId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { deleteMetaTemplate } from '@/infrastructure/whatsapp/templates'

interface DeleteResult {
  success: boolean
  error?: string
}

// restaurantId scopes the lookup rather than being compared afterwards: a template
// belonging to another tenant is simply not found, so ids stay non-enumerable and
// the Meta delete can never run against a foreign WABA.
export async function deleteWhatsAppTemplate(
  templateId: string,
  restaurantId: string
): Promise<DeleteResult> {
  const template = await findTemplateByIdForRestaurant(templateId, restaurantId)
  if (!template) {
    return { success: false, error: 'Template not found' }
  }

  if (template.metaTemplateId) {
    await deleteFromMeta(template.restaurantId, template.name)
  }

  await softDeleteTemplate(templateId, restaurantId)
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
