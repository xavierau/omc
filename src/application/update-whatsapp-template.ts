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

  // Delete old Meta template first — Meta requires delete before re-create
  // for templates with the same name
  await deleteOldMetaTemplate(existing)

  // Attempt to create the new template on Meta before updating local DB
  const businessAccountId = await getMetaBusinessAccountId(existing.restaurantId)
  let metaTemplateId: string | null = null
  let metaError: string | undefined

  if (businessAccountId) {
    const merged = { ...existing, ...input }
    const metaResult = await createMetaTemplate(businessAccountId, {
      name: merged.name,
      language: merged.language,
      category: merged.category,
      components: merged.components as Array<{ type: string; [k: string]: unknown }>,
      parameterFormat: 'NAMED',
    })

    if (metaResult) {
      metaTemplateId = metaResult.id
    } else {
      metaError = 'Updated locally but failed to re-submit to Meta'
    }
  }

  // Now persist locally — metaTemplateId is only cleared if we got a new one
  // or if we genuinely couldn't recreate it
  const updated = await updateTemplate(templateId, {
    ...input,
    status: metaTemplateId ? 'pending' : 'draft',
    metaTemplateId,
    rejectionReason: null,
  })

  return { template: updated, ...(metaError && { error: metaError }) }
}

async function deleteOldMetaTemplate(
  template: WhatsAppTemplate
): Promise<void> {
  if (!template.metaTemplateId) return

  const businessAccountId = await getMetaBusinessAccountId(template.restaurantId)
  if (!businessAccountId) return

  await deleteMetaTemplate(businessAccountId, template.name)
}
