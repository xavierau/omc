import { getMetaBusinessAccountId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { listMetaTemplates } from '@/infrastructure/whatsapp/templates'
import type { MetaTemplateListItem } from '@/infrastructure/whatsapp/templates'
import {
  listTemplates,
  updateTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import {
  mapMetaTemplateStatus,
  SYNCABLE_STATUSES,
  NO_REJECTION_REASON,
} from '@/domain/services/meta-template-status'

interface StatusChange {
  id: string
  oldStatus: string
  newStatus: string
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
  const newStatus = mapMetaTemplateStatus(meta.status)
  if (!newStatus || newStatus === local.status) return null

  await updateTemplate(local.id, {
    status: newStatus,
    ...(newStatus === 'rejected' && { rejectionReason: readRejectedReason(meta) }),
  })
  return { id: local.id, oldStatus: local.status, newStatus }
}

/**
 * Meta's rejection reason is not in the SDK's list-item type; it arrives
 * camelized at runtime when present, so both shapes are read defensively.
 */
function readRejectedReason(meta: MetaTemplateListItem): string {
  const candidates = [meta.rejectedReason, meta.rejected_reason]
  const reason = candidates.find((c) => typeof c === 'string' && c.length > 0)
  return (reason as string) ?? NO_REJECTION_REASON
}
