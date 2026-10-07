import { listTemplates } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import type { TemplateStatus, TemplateCategory } from '@/domain/entities/whatsapp-template'
import type { ListTemplatesResult } from '@/domain/interfaces/whatsapp-template-repository'

interface ListParams {
  restaurantId: string
  status?: TemplateStatus
  category?: TemplateCategory
  page?: number
  pageSize?: number
}

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20

export async function listWhatsAppTemplates(
  params: ListParams
): Promise<ListTemplatesResult> {
  return listTemplates({
    restaurantId: params.restaurantId,
    status: params.status,
    category: params.category,
    page: params.page ?? DEFAULT_PAGE,
    pageSize: params.pageSize ?? DEFAULT_PAGE_SIZE,
  })
}
