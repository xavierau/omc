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
import { resolveHeaderMedia, mapMediaHandleError } from '@/application/resolve-header-media'

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

  // Components are stored with the image URL the dashboard uploaded; the Meta
  // resumable-upload handle is minted later, at submit time only (see
  // submitToMeta). Storing the handle would be wrong — it expires in ~24h.
  const components = normalizeTemplateComponents(params.components)

  const template = await createTemplate({
    restaurantId: params.restaurantId,
    name: params.name,
    language: params.language,
    category: params.category,
    components,
  })

  // `||`, not `??`: an unset WABA is stored as '' rather than NULL, and '' must
  // still fall through to auto-resolution or the draft is never submitted at all.
  const businessAccountId = await getMetaBusinessAccountId(params.restaurantId)
    || await autoResolveWabaId(params.restaurantId)

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
  // Turn any image-header URL into a Meta handle before submitting. Runs on a
  // copy: the stored draft keeps the URL.
  const resolved = await resolveHeaderMedia(params.components)
  if (!resolved.ok) {
    const { message, errorCode } = mapMediaHandleError(resolved.error)
    return { template, error: message, errorCode }
  }

  // Belt-and-suspenders: a media header that could not be minted (e.g. no source
  // URL at all) must never reach Meta as an un-approvable payload.
  const validationError = validateTemplateComponents(resolved.components)
  if (validationError) {
    return { template, error: validationError, errorCode: 'provider_error' }
  }

  const metaResult = await createMetaTemplate(businessAccountId, {
    name: params.name,
    language: params.language,
    category: params.category,
    components: prepareTemplateComponents(resolved.components),
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
