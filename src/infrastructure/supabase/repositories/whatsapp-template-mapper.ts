import type {
  WhatsAppTemplate,
  TemplateComponent,
} from '@/domain/entities/whatsapp-template'
import type { CreateTemplateParams } from '@/domain/interfaces/whatsapp-template-repository'

export interface WhatsAppTemplateRow {
  id: string
  restaurant_id: string
  meta_template_id: string | null
  name: string
  language: string
  category: string
  status: string
  components: unknown
  parameter_format: string
  rejection_reason: string | null
  created_at: string
  updated_at: string
}

export function mapRowToTemplate(row: WhatsAppTemplateRow): WhatsAppTemplate {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    metaTemplateId: row.meta_template_id,
    name: row.name,
    language: row.language,
    category: row.category as WhatsAppTemplate['category'],
    status: row.status as WhatsAppTemplate['status'],
    components: row.components as TemplateComponent[],
    parameterFormat: row.parameter_format as WhatsAppTemplate['parameterFormat'],
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapTemplateToInsert(params: CreateTemplateParams) {
  return {
    restaurant_id: params.restaurantId,
    name: params.name,
    language: params.language,
    category: params.category,
    status: 'draft' as const,
    components: params.components,
    parameter_format: 'NAMED' as const,
  }
}
