import { getMetaBusinessAccountId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { listMetaTemplates } from '@/infrastructure/whatsapp/templates'
import type { MetaTemplateListItem } from '@/infrastructure/whatsapp/templates'
import {
  listTemplates,
  updateTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import type { WhatsAppTemplate, TemplateStatus } from '@/domain/entities/whatsapp-template'

interface StatusChange {
  id: string
  oldStatus: string
  newStatus: string
}

const SYNCABLE_STATUSES: TemplateStatus[] = ['pending', 'approved', 'paused']

const META_STATUS_MAP: Record<string, TemplateStatus> = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PENDING: 'pending',
  PAUSED: 'paused',
  DISABLED: 'disabled',
}

export async function syncTemplateStatus(
  restaurantId: string
): Promise<{ updated: StatusChange[] }> {
  const businessAccountId = await getMetaBusinessAccountId(restaurantId)
  if (!businessAccountId) return { updated: [] }

  const metaTemplates = await listMetaTemplates(businessAccountId)
  if (!metaTemplates) return { updated: [] }

  const localResult = await listTemplates({
    restaurantId,
    page: 1,
    pageSize: 1000,
  })

  const syncable = localResult.templates.filter(
    (t) => t.metaTemplateId && SYNCABLE_STATUSES.includes(t.status)
  )

  const changes: StatusChange[] = []
  for (const local of syncable) {
    const change = await syncSingleTemplate(local, metaTemplates)
    if (change) changes.push(change)
  }

  return { updated: changes }
}

async function syncSingleTemplate(
  local: WhatsAppTemplate,
  metaTemplates: MetaTemplateListItem[]
): Promise<StatusChange | null> {
  const meta = metaTemplates.find(
    (m) => m.name === local.name && (m.language ?? '') === local.language
  )
  if (!meta) return null

  if (!meta.status) return null
  const newStatus = META_STATUS_MAP[meta.status]
  if (!newStatus || newStatus === local.status) return null

  await updateTemplate(local.id, { status: newStatus })
  return { id: local.id, oldStatus: local.status, newStatus }
}
