import { type MessageStatus, isProgression } from '../value-objects/message-status'

export type MessageDirection = 'outbound' | 'inbound'
export type MessageCategory =
  | 'marketing'
  | 'utility'
  | 'authentication'
  | 'service'
export type MessageContentType = 'text' | 'image' | 'template' | 'interactive'

export interface WhatsAppMessageProps {
  id: string
  restaurantId: string
  memberId: string | null
  campaignId: string | null
  phoneE164: string
  direction: MessageDirection
  category: MessageCategory
  messageType: MessageContentType
  templateId: string | null
  templateName: string | null
  contentPreview: string | null
  kapsoMessageId: string | null
  status: MessageStatus
  errorCode: string | null
  errorTitle: string | null
  errorDetails: string | null
  queuedAt: string
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  failedAt: string | null
}

export interface QueueOutboundInput {
  id: string
  restaurantId: string
  memberId: string | null
  campaignId: string | null
  phoneE164: string
  category: MessageCategory
  messageType: MessageContentType
  templateId: string | null
  templateName: string | null
  contentPreview: string | null
}

export interface StatusUpdate {
  status: MessageStatus
  timestamp?: string
  errorCode?: string | null
  errorTitle?: string | null
  errorDetails?: string | null
}

export class WhatsAppMessage {
  private constructor(private readonly props: WhatsAppMessageProps) {}

  static queue(input: QueueOutboundInput): WhatsAppMessage {
    const now = new Date().toISOString()
    return new WhatsAppMessage({
      id: input.id,
      restaurantId: input.restaurantId,
      memberId: input.memberId,
      campaignId: input.campaignId,
      phoneE164: input.phoneE164,
      direction: 'outbound',
      category: input.category,
      messageType: input.messageType,
      templateId: input.templateId,
      templateName: input.templateName,
      contentPreview: input.contentPreview,
      kapsoMessageId: null,
      status: 'queued',
      errorCode: null,
      errorTitle: null,
      errorDetails: null,
      queuedAt: now,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
    })
  }

  static fromProps(props: WhatsAppMessageProps): WhatsAppMessage {
    return new WhatsAppMessage(props)
  }

  /**
   * Idempotent forward-only state transition. Out-of-order webhooks promote to
   * the most-progressed state but never regress. Returns the same instance
   * when the update is rejected so callers can detect no-ops via reference.
   */
  applyStatusUpdate(update: StatusUpdate): WhatsAppMessage {
    if (!isProgression(this.props.status, update.status)) return this
    const at = update.timestamp ?? new Date().toISOString()
    return new WhatsAppMessage({
      ...this.props,
      status: update.status,
      sentAt: update.status === 'sent' ? at : this.props.sentAt,
      deliveredAt:
        update.status === 'delivered' ? at : this.props.deliveredAt,
      readAt: update.status === 'read' ? at : this.props.readAt,
      failedAt: update.status === 'failed' ? at : this.props.failedAt,
      errorCode:
        update.status === 'failed'
          ? update.errorCode ?? this.props.errorCode
          : this.props.errorCode,
      errorTitle:
        update.status === 'failed'
          ? update.errorTitle ?? this.props.errorTitle
          : this.props.errorTitle,
      errorDetails:
        update.status === 'failed'
          ? update.errorDetails ?? this.props.errorDetails
          : this.props.errorDetails,
    })
  }

  get snapshot(): Readonly<WhatsAppMessageProps> {
    return this.props
  }
}
