import {
  WhatsAppMessage,
  type MessageCategory,
  type MessageContentType,
  type MessageDirection,
  type WhatsAppMessageProps,
} from '@/domain/entities/whatsapp-message'
import type { MessageStatus } from '@/domain/value-objects/message-status'

export interface WhatsAppMessageRow {
  id: string
  restaurant_id: string
  member_id: string | null
  campaign_id: string | null
  phone_e164: string
  direction: MessageDirection
  category: MessageCategory
  message_type: MessageContentType
  template_id: string | null
  template_name: string | null
  content_preview: string | null
  kapso_message_id: string | null
  status: MessageStatus
  error_code: string | null
  error_title: string | null
  error_details: string | null
  queued_at: string
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  failed_at: string | null
}

export interface QueuedInsertRow {
  id: string
  restaurant_id: string
  member_id: string | null
  campaign_id: string | null
  phone_e164: string
  direction: MessageDirection
  category: MessageCategory
  message_type: MessageContentType
  template_id: string | null
  template_name: string | null
  content_preview: string | null
  status: MessageStatus
  queued_at: string
}

export function toEntity(row: WhatsAppMessageRow): WhatsAppMessage {
  const props: WhatsAppMessageProps = {
    id: row.id,
    restaurantId: row.restaurant_id,
    memberId: row.member_id,
    campaignId: row.campaign_id,
    phoneE164: row.phone_e164,
    direction: row.direction,
    category: row.category,
    messageType: row.message_type,
    templateId: row.template_id,
    templateName: row.template_name,
    contentPreview: row.content_preview,
    kapsoMessageId: row.kapso_message_id,
    status: row.status,
    errorCode: row.error_code,
    errorTitle: row.error_title,
    errorDetails: row.error_details,
    queuedAt: row.queued_at,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
    failedAt: row.failed_at,
  }
  return WhatsAppMessage.fromProps(props)
}

export function toQueuedRow(m: WhatsAppMessage): QueuedInsertRow {
  const s = m.snapshot
  return {
    id: s.id,
    restaurant_id: s.restaurantId,
    member_id: s.memberId,
    campaign_id: s.campaignId,
    phone_e164: s.phoneE164,
    direction: s.direction,
    category: s.category,
    message_type: s.messageType,
    template_id: s.templateId,
    template_name: s.templateName,
    content_preview: s.contentPreview,
    status: s.status,
    queued_at: s.queuedAt,
  }
}
