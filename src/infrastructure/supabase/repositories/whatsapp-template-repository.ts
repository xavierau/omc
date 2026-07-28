import { createServerSupabaseClient } from '../client'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import type {
  WhatsAppTemplateRepository,
  CreateTemplateParams,
  UpdateTemplateParams,
  ListTemplatesParams,
  ListTemplatesResult,
} from '@/domain/interfaces/whatsapp-template-repository'
import { mapRowToTemplate, mapTemplateToInsert } from './whatsapp-template-mapper'

const TABLE = 'whatsapp_templates'

export async function create(params: CreateTemplateParams): Promise<WhatsAppTemplate> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .insert(mapTemplateToInsert(params))
    .select('*')
    .single()

  if (error || !data) throw new Error(`createTemplate: ${error?.message}`)
  return mapRowToTemplate(data)
}

export async function findById(id: string): Promise<WhatsAppTemplate | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .neq('status', 'deleted')
    .single()

  if (error || !data) return null
  return mapRowToTemplate(data)
}

export async function findByNameAndLanguage(
  restaurantId: string,
  name: string,
  language: string,
): Promise<WhatsAppTemplate | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('name', name)
    .eq('language', language)
    .neq('status', 'deleted')
    .single()

  if (error || !data) return null
  return mapRowToTemplate(data)
}

export async function findByMetaTemplateId(
  restaurantId: string,
  metaTemplateId: string,
): Promise<WhatsAppTemplate | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('meta_template_id', metaTemplateId)
    .neq('status', 'deleted')
    .single()

  if (error || !data) return null
  return mapRowToTemplate(data)
}

export async function list(params: ListTemplatesParams): Promise<ListTemplatesResult> {
  const supabase = createServerSupabaseClient()
  const { restaurantId, page, pageSize, status, category } = params
  const from = (page - 1) * pageSize

  let query = supabase
    .from(TABLE)
    .select('*', { count: 'exact' })
    .eq('restaurant_id', restaurantId)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1)

  if (status) query = query.eq('status', status)
  if (category) query = query.eq('category', category)

  const { data, error, count } = await query
  if (error) throw new Error(`listTemplates: ${error.message}`)

  return {
    templates: (data ?? []).map(mapRowToTemplate),
    total: count ?? 0,
  }
}

export async function update(
  id: string,
  changes: UpdateTemplateParams,
): Promise<WhatsAppTemplate> {
  const supabase = createServerSupabaseClient()
  const updateFields: Record<string, unknown> = {}

  if (changes.name !== undefined) updateFields.name = changes.name
  if (changes.language !== undefined) updateFields.language = changes.language
  if (changes.category !== undefined) updateFields.category = changes.category
  if (changes.metaTemplateId !== undefined) {
    updateFields.meta_template_id = changes.metaTemplateId
  }
  if (changes.status !== undefined) updateFields.status = changes.status
  if (changes.components !== undefined) updateFields.components = changes.components
  if (changes.rejectionReason !== undefined) {
    updateFields.rejection_reason = changes.rejectionReason
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update(updateFields)
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) throw new Error(`updateTemplate: ${error?.message}`)
  return mapRowToTemplate(data)
}

export async function softDelete(id: string): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from(TABLE)
    .update({ status: 'deleted' })
    .eq('id', id)

  if (error) throw new Error(`softDeleteTemplate: ${error.message}`)
}

// Aliases used by application layer
export {
  create as createTemplate,
  findById as findTemplateById,
  findByNameAndLanguage as findTemplateByNameAndLanguage,
  findByMetaTemplateId as findTemplateByMetaTemplateId,
  list as listTemplates,
  update as updateTemplate,
  softDelete as softDeleteTemplate,
}

export const whatsappTemplateRepository: WhatsAppTemplateRepository = {
  create,
  findById,
  findByNameAndLanguage,
  findByMetaTemplateId,
  list,
  update,
  softDelete,
}
