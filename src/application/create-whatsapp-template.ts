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

  const template = await createTemplate({
    restaurantId: params.restaurantId,
    name: params.name,
    language: params.language,
    category: params.category,
    components: params.components,
  })

  const businessAccountId = await getMetaBusinessAccountId(params.restaurantId)
    ?? await autoResolveWabaId(params.restaurantId)

  if (!businessAccountId) {
    return { template }
  }

  return submitToMeta(template, businessAccountId, params)
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
    components: params.components as Array<{ type: string; [k: string]: unknown }>,
    parameterFormat: 'NAMED',
  })

  if (!metaResult) {
    return { template, error: 'Failed to submit template to Meta' }
  }

  const updated = await updateTemplate(template.id, {
    metaTemplateId: metaResult.id,
    status: 'pending',
  })

  return { template: updated }
}
