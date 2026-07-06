import {
  sendTextMessage,
  sendImageMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  sendCtaUrlButton,
} from '@/infrastructure/kapso/client'
import type { WhatsAppMessagingPort } from '@/domain/ports/whatsapp-messaging'

export const kapsoMessagingAdapter: WhatsAppMessagingPort = {
  sendText: sendTextMessage,
  sendImage: sendImageMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  sendCtaUrlButton,
}
