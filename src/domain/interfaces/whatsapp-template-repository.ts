import type {
  WhatsAppTemplate,
  TemplateStatus,
  TemplateCategory,
  TemplateComponent,
} from '../entities/whatsapp-template'

export interface ListTemplatesParams {
  restaurantId: string
  status?: TemplateStatus
  category?: TemplateCategory
  page: number
  pageSize: number
}

export interface ListTemplatesResult {
  templates: WhatsAppTemplate[]
  total: number
}

export interface CreateTemplateParams {
  restaurantId: string
  name: string
  language: string
  category: TemplateCategory
  components: TemplateComponent[]
}

export interface UpdateTemplateParams {
  name?: string
  language?: string
  category?: TemplateCategory
  metaTemplateId?: string | null
  status?: TemplateStatus
  components?: TemplateComponent[]
  rejectionReason?: string | null
}

export interface WhatsAppTemplateRepository {
  create(params: CreateTemplateParams): Promise<WhatsAppTemplate>
  findById(id: string): Promise<WhatsAppTemplate | null>
  findByIdForRestaurant(
    id: string,
    restaurantId: string
  ): Promise<WhatsAppTemplate | null>
  findByNameAndLanguage(
    restaurantId: string,
    name: string,
    language: string
  ): Promise<WhatsAppTemplate | null>
  findByMetaTemplateId(
    restaurantId: string,
    metaTemplateId: string
  ): Promise<WhatsAppTemplate | null>
  list(params: ListTemplatesParams): Promise<ListTemplatesResult>
  update(id: string, changes: UpdateTemplateParams): Promise<WhatsAppTemplate>
  softDelete(id: string, restaurantId: string): Promise<void>
}
