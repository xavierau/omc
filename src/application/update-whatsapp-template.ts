import { validateTemplateName } from '@/domain/entities/whatsapp-template'
import type {
  WhatsAppTemplate,
  TemplateCategory,
  TemplateComponent,
} from '@/domain/entities/whatsapp-template'
import {
  findTemplateById,
  updateTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { getMetaBusinessAccountId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import {
  createMetaTemplate,
  deleteMetaTemplate,
} from '@/infrastructure/whatsapp/templates'

interface UpdateTemplateInput {
  name?: string
  language?: string
  category?: TemplateCategory
  components?: TemplateComponent[]
}

interface UpdateTemplateResult {
  template: WhatsAppTemplate
  error?: string
}

export async function updateWhatsAppTemplate(
  templateId: string,
  input: UpdateTemplateInput
): Promise<UpdateTemplateResult> {
  const existing = await findTemplateById(templateId)
  if (!existing) throw new Error('Template not found')

  if (input.name !== undefined && !validateTemplateName(input.name)) {
    throw new Error('Invalid template name: must be lowercase alphanumeric and underscores only')
  }

  const updated = await updateTemplate(templateId, {
    ...input,
    status: 'draft',
    metaTemplateId: null,
    rejectionReason: null,
  })

  await deleteOldMetaTemplate(existing)
  return resubmitToMeta(updated)
}

async function deleteOldMetaTemplate(
  template: WhatsAppTemplate
): Promise<void> {
  if (!template.metaTemplateId) return

  const businessAccountId = await getMetaBusinessAccountId(template.restaurantId)
  if (!businessAccountId) return

  await deleteMetaTemplate(businessAccountId, template.name)
}

async function resubmitToMeta(
  template: WhatsAppTemplate
): Promise<UpdateTemplateResult> {
  const businessAccountId = await getMetaBusinessAccountId(template.restaurantId)
  if (!businessAccountId) return { template }

  const metaResult = await createMetaTemplate(businessAccountId, {
    name: template.name,
    language: template.language,
    category: template.category,
    components: template.components as Array<{ type: string; [k: string]: unknown }>,
    parameterFormat: 'NAMED',
  })

  if (!metaResult) {
    return { template, error: 'Updated locally but failed to re-submit to Meta' }
  }

  const resubmitted = await updateTemplate(template.id, {
    metaTemplateId: metaResult.id,
    status: 'pending',
  })

  return { template: resubmitted }
}
