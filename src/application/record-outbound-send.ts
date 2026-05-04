import { randomUUID } from 'crypto'
import {
  WhatsAppMessage,
  type MessageCategory,
  type MessageContentType,
} from '@/domain/entities/whatsapp-message'
import {
  insertQueuedMessage,
  attachKapsoMessageId,
  markFailedNoBspId,
} from '@/infrastructure/supabase/repositories/whatsapp-message-repository'
import type { SendResult } from '@/infrastructure/whatsapp/messaging-result'

export interface RecordOutboundSendArgs {
  restaurantId: string
  memberId: string | null
  campaignId: string | null
  phoneE164: string
  category: MessageCategory
  messageType: MessageContentType
  contentPreview: string | null
  template?: { id: string; name: string }
  send: () => Promise<SendResult>
  trackingEnabled: boolean
}

/**
 * Two-phase send (insert queued row -> call BSP -> attach wamid). When
 * tracking is disabled (`WAQ_TRACK_MESSAGES != '1'`), short-circuits to
 * send() with no DB writes so prod is forward-compatible during rollout.
 */
export async function recordOutboundSend(
  args: RecordOutboundSendArgs
): Promise<SendResult> {
  if (!args.trackingEnabled) return args.send()

  const message = WhatsAppMessage.queue({
    id: randomUUID(),
    restaurantId: args.restaurantId,
    memberId: args.memberId,
    campaignId: args.campaignId,
    phoneE164: args.phoneE164,
    category: args.category,
    messageType: args.messageType,
    templateId: args.template?.id ?? null,
    templateName: args.template?.name ?? null,
    contentPreview: args.contentPreview,
  })
  const localId = message.snapshot.id

  await insertQueuedMessage(message)
  return invokeAndPersist(localId, args.send)
}

async function invokeAndPersist(
  localId: string,
  send: () => Promise<SendResult>
): Promise<SendResult> {
  let result: SendResult
  try {
    result = await send()
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err)
    await markFailedNoBspId(localId, { title: 'send_threw', details })
    return {
      ok: false,
      kapsoMessageId: null,
      raw: null,
      error: { title: 'send_threw', details },
    }
  }
  if (result.ok && result.kapsoMessageId) {
    await attachKapsoMessageId(localId, result.kapsoMessageId)
    return result
  }
  await markFailedNoBspId(localId, {
    title: result.error?.title ?? 'send_failed',
    details: result.error?.details,
  })
  return result
}
