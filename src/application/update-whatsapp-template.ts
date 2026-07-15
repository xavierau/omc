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
import {
  normalizeTemplateComponents,
  prepareTemplateComponents,
} from '@/domain/services/prepare-template-components'
import { validateTemplateComponents } from '@/domain/services/validate-template-components'

interface UpdateTemplateInput {
  name?: string
  language?: string
  category?: TemplateCategory
  components?: TemplateComponent[]
}

interface UpdateTemplateResult {
  template: WhatsAppTemplate
  error?: string
  errorCode?: 'meta_rejected' | 'provider_not_configured'
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

  const merged = { ...existing, ...input }

  // Runs BEFORE the delete below: a payload Meta is certain to refuse must not
  // cost the caller their live template.
  const validationError = validateTemplateComponents(merged.components)
  if (validationError) {
    throw new Error(validationError)
  }

  const changes = normalizeChanges(input)

  const businessAccountId = await getMetaBusinessAccountId(existing.restaurantId)
  if (!businessAccountId) {
    // Any remote template is still live, so keep the pointer to it.
    return { template: await updateTemplate(templateId, changes) }
  }

  // Meta requires delete before re-create for templates with the same name
  await deleteOldMetaTemplate(existing, businessAccountId)

  return resubmitToMeta(templateId, merged, changes, businessAccountId)
}

function normalizeChanges(input: UpdateTemplateInput): UpdateTemplateInput {
  if (input.components === undefined) return input
  return { ...input, components: normalizeTemplateComponents(input.components) }
}

async function resubmitToMeta(
  templateId: string,
  merged: WhatsAppTemplate,
  changes: UpdateTemplateInput,
  businessAccountId: string
): Promise<UpdateTemplateResult> {
  const metaResult = await createMetaTemplate(businessAccountId, {
    name: merged.name,
    language: merged.language,
    category: merged.category,
    components: prepareTemplateComponents(merged.components),
    parameterFormat: 'NAMED',
  })

  if (metaResult.ok) {
    const updated = await updateTemplate(templateId, {
      ...changes,
      status: 'pending',
      metaTemplateId: metaResult.templateId,
      rejectionReason: null,
    })
    return { template: updated }
  }

  // Without a client the delete above was a no-op, so nothing remote changed.
  if (metaResult.error?.title === 'kapso_no_api_key') {
    const updated = await updateTemplate(templateId, changes)
    return {
      template: updated,
      error: 'WhatsApp provider not configured',
      errorCode: 'provider_not_configured',
    }
  }

  // The old template is genuinely gone from Meta now — record that honestly.
  const details = metaResult.error?.details ?? 'Updated locally but failed to re-submit to Meta'
  const updated = await updateTemplate(templateId, {
    ...changes,
    status: 'rejected',
    metaTemplateId: null,
    rejectionReason: details,
  })

  return { template: updated, error: details, errorCode: 'meta_rejected' }
}

async function deleteOldMetaTemplate(
  template: WhatsAppTemplate,
  businessAccountId: string
): Promise<void> {
  if (!template.metaTemplateId) return

  await deleteMetaTemplate(businessAccountId, template.name)
}
