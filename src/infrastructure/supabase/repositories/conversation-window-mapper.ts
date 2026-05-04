import {
  ConversationWindow,
  type ConversationWindowProps,
} from '@/domain/entities/conversation-window'

export interface ConversationWindowRow {
  id: string
  restaurant_id: string
  phone_e164: string
  opened_at: string
  last_inbound_at: string
  expires_at: string
}

export function toEntity(row: ConversationWindowRow): ConversationWindow {
  const props: ConversationWindowProps = {
    id: row.id,
    restaurantId: row.restaurant_id,
    phoneE164: row.phone_e164,
    openedAt: row.opened_at,
    lastInboundAt: row.last_inbound_at,
    expiresAt: row.expires_at,
  }
  return ConversationWindow.fromProps(props)
}

export function toInsertRow(w: ConversationWindow): ConversationWindowRow {
  const s = w.snapshot
  return {
    id: s.id,
    restaurant_id: s.restaurantId,
    phone_e164: s.phoneE164,
    opened_at: s.openedAt,
    last_inbound_at: s.lastInboundAt,
    expires_at: s.expiresAt,
  }
}
