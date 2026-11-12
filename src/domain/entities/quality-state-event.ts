import type {
  MessagingTier,
  QualityRating,
} from '../value-objects/quality-rating'

export interface QualityStateEventProps {
  id: string
  restaurantId: string
  // At least one of phoneNumberId / displayPhoneNumber must be present.
  // Meta's `phone_number_quality_update` event ships only display number;
  // `account_update` ships both. Forensic queries use either column.
  phoneNumberId: string | null
  displayPhoneNumber: string | null
  qualityRating: QualityRating
  messagingTier: MessagingTier | null
  flagged: boolean
  rawPayload: Record<string, unknown> | null
  transitionedAt: string
}

export interface QualityStateEventInput {
  id: string
  restaurantId: string
  phoneNumberId?: string | null
  displayPhoneNumber?: string | null
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
    const phoneNumberId = trimOrNull(input.phoneNumberId)
    const displayPhoneNumber = trimOrNull(input.displayPhoneNumber)
    if (!phoneNumberId && !displayPhoneNumber) {
      throw new Error(
        'QualityStateEvent: at least one of phoneNumberId or displayPhoneNumber is required'
      )
    }
    return new QualityStateEvent({
      id: input.id,
      restaurantId: input.restaurantId,
      phoneNumberId,
      displayPhoneNumber,
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

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}
