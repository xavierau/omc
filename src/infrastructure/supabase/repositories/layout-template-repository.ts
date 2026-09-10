import { createServerSupabaseClient } from '../client'
import type { LayoutTemplate } from '@/domain/interfaces/layout-verification'

export async function getActiveTemplate(
  restaurantId: string
): Promise<{ template_json: LayoutTemplate; threshold: number } | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('receipt_layout_templates')
    .select('template_json, threshold')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'active')
    .single()

  if (error || !data) return null
  return {
    template_json: data.template_json as LayoutTemplate,
    threshold: Number(data.threshold),
  }
}

export async function createTemplate(params: {
  restaurantId: string
  templateJson: LayoutTemplate
  sampleImageUrls: string[]
  sampleCount: number
  threshold?: number
}): Promise<string> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('receipt_layout_templates')
    .insert({
      restaurant_id: params.restaurantId,
      template_json: params.templateJson,
      sample_image_urls: params.sampleImageUrls,
      sample_count: params.sampleCount,
      threshold: params.threshold ?? 0.65,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`createTemplate: ${error?.message}`)
  }
  return data.id
}

export async function archiveTemplates(
  restaurantId: string
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('receipt_layout_templates')
    .update({ status: 'archived' })
    .eq('restaurant_id', restaurantId)
    .eq('status', 'active')

  if (error) throw new Error(`archiveTemplates: ${error.message}`)
}
