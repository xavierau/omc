import {
  validateTemplateName,
} from '@/domain/entities/whatsapp-template'
import type {
  WhatsAppTemplate,
  TemplateCategory,
  TemplateComponent,
} from '@/domain/entities/whatsapp-template'
import {
  createTemplate,
  findTemplateByNameAndLanguage,
  updateTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import {
  getMetaBusinessAccountId,
  getRestaurantPhoneNumberId,
  updateMetaBusinessAccountId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { createMetaTemplate, resolveWabaId } from '@/infrastructure/whatsapp/templates'
import {
  normalizeTemplateComponents,
  prepareTemplateComponents,
} from '@/domain/services/prepare-template-components'
import { validateTemplateComponents } from '@/domain/services/validate-template-components'

interface CreateTemplateParams {
  restaurantId: string
  name: string
  language: string
  category: TemplateCategory
  components: TemplateComponent[]
}

interface CreateTemplateResult {
  template: WhatsAppTemplate
  error?: string
  errorCode?: 'meta_rejected' | 'provider_not_configured' | 'provider_error'
}

export async function createWhatsAppTemplate(
  params: CreateTemplateParams
): Promise<CreateTemplateResult> {
  if (!validateTemplateName(params.name)) {
    throw new Error('Invalid template name: must be lowercase alphanumeric and underscores only')
  }

  const existing = await findTemplateByNameAndLanguage(
    params.restaurantId,
    params.name,
    params.language
  )
  if (existing) {
    throw new Error(`Template "${params.name}" with language "${params.language}" already exists`)
  }

  const validationError = validateTemplateComponents(params.components)
  if (validationError) {
    throw new Error(validationError)
  }

  const components = normalizeTemplateComponents(params.components)

  const template = await createTemplate({
    restaurantId: params.restaurantId,
    name: params.name,
    language: params.language,
    category: params.category,
    components,
  })

  const businessAccountId = await getMetaBusinessAccountId(params.restaurantId)
    ?? await autoResolveWabaId(params.restaurantId)

  if (!businessAccountId) {
    return { template }
  }

  return submitToMeta(template, businessAccountId, { ...params, components })
}

async function autoResolveWabaId(
  restaurantId: string
): Promise<string | null> {
  const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
  if (!phoneNumberId) return null

  const wabaId = await resolveWabaId(phoneNumberId)
  if (!wabaId) return null

  await updateMetaBusinessAccountId(restaurantId, wabaId)
  return wabaId
}

async function submitToMeta(
  template: WhatsAppTemplate,
  businessAccountId: string,
  params: CreateTemplateParams
): Promise<CreateTemplateResult> {
  const metaResult = await createMetaTemplate(businessAccountId, {
    name: params.name,
    language: params.language,
    category: params.category,
    components: prepareTemplateComponents(params.components),
    parameterFormat: 'NAMED',
  })

  if (metaResult.ok) {
    const updated = await updateTemplate(template.id, {
      metaTemplateId: metaResult.templateId,
      status: 'pending',
    })
    return { template: updated }
  }

  // Only Meta refusing the content is a rejection. A missing client or a transient
  // failure means the draft was never judged — leave it alone so the operator
  // retries instead of hunting for a content problem that doesn't exist.
  if (metaResult.error?.title === 'meta_rejected') {
    const details = metaResult.error.details ?? 'Meta rejected the template'
    const updated = await updateTemplate(template.id, {
      status: 'rejected',
      rejectionReason: details,
    })
    return { template: updated, error: details, errorCode: 'meta_rejected' }
  }

  if (metaResult.error?.title === 'kapso_no_api_key') {
    return {
      template,
      error: 'WhatsApp provider not configured',
      errorCode: 'provider_not_configured',
    }
  }

  return {
    template,
    error: metaResult.error?.details ?? 'Failed to submit template to Meta',
    errorCode: 'provider_error',
  }
}
