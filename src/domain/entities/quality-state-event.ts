import type {
  MessagingTier,
  QualityRating,
} from '../value-objects/quality-rating'

export interface QualityStateEventProps {
  id: string
  restaurantId: string
  phoneNumberId: string
  qualityRating: QualityRating
  messagingTier: MessagingTier | null
  flagged: boolean
  rawPayload: Record<string, unknown> | null
  transitionedAt: string
}

export interface QualityStateEventInput {
  id: string
  restaurantId: string
  phoneNumberId: string
  qualityRating: QualityRating
  messagingTier?: MessagingTier | null
  flagged?: boolean
  rawPayload?: Record<string, unknown> | null
  transitionedAt?: string
}

/**
 * One quality / tier transition observed for a tenant. Immutable; one per
 * webhook event. Persisted to `tenant_quality_state` via the repository.
 */
export class QualityStateEvent {
  private constructor(private readonly props: QualityStateEventProps) {}

  static fromWebhook(input: QualityStateEventInput): QualityStateEvent {
    assertNonEmpty('restaurantId', input.restaurantId)
    assertNonEmpty('phoneNumberId', input.phoneNumberId)
    return new QualityStateEvent({
      id: input.id,
      restaurantId: input.restaurantId,
      phoneNumberId: input.phoneNumberId,
      qualityRating: input.qualityRating,
      messagingTier: input.messagingTier ?? null,
      flagged: input.flagged ?? false,
      rawPayload: input.rawPayload ?? null,
      transitionedAt: input.transitionedAt ?? new Date().toISOString(),
    })
  }

  static fromProps(props: QualityStateEventProps): QualityStateEvent {
    return new QualityStateEvent(props)
  }

  get snapshot(): Readonly<QualityStateEventProps> {
    return this.props
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`QualityStateEvent: ${field} is required`)
  }
}
