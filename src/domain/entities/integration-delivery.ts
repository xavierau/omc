// INT-001: one fan-out row of `integration_deliveries` (WI-6 owns the
// processor that drives these transitions; this entity is where the state
// machine itself is enforced so an invalid transition is a thrown error,
// not a silently-wrong status column).

export type IntegrationDeliveryStatus =
  | 'queued'
  | 'delivering'
  | 'retrying'
  | 'delivered'
  | 'dead_lettered'
  | 'paused'
  | 'skipped'

const ALLOWED_TRANSITIONS: Record<IntegrationDeliveryStatus, IntegrationDeliveryStatus[]> = {
  queued: ['delivering', 'paused', 'skipped'],
  delivering: ['delivered', 'retrying', 'dead_lettered'],
  retrying: ['delivering', 'dead_lettered'],
  paused: ['queued'],
  // Retry (US-9): retried_at IS NULL -> re-enqueue for one more attempt.
  dead_lettered: ['queued'],
  delivered: [],
  skipped: [],
}

export interface IntegrationDeliveryProps {
  id: string
  integrationId: string
  restaurantId: string
  eventId: string
  status: IntegrationDeliveryStatus
  attempts: number
  lastHttpStatus: number | null
  lastErrorCode: string | null
  lastLatencyMs: number | null
  responseExcerpt: string | null
  nextRetryAt: string | null
  enqueuedAt: string | null
  deliveredAt: string | null
  deadLetteredAt: string | null
  retriedAt: string | null
}

export class IntegrationDelivery {
  private constructor(private readonly props: IntegrationDeliveryProps) {}

  static fromProps(props: IntegrationDeliveryProps): IntegrationDelivery {
    return new IntegrationDelivery(props)
  }

  get snapshot(): Readonly<IntegrationDeliveryProps> {
    return this.props
  }

  canTransitionTo(next: IntegrationDeliveryStatus): boolean {
    return ALLOWED_TRANSITIONS[this.props.status].includes(next)
  }

  /** Returns a NEW IntegrationDelivery with `status` set to `next`, or throws
   * if the transition isn't in the state machine. Never mutates `this`. */
  transitionTo(
    next: IntegrationDeliveryStatus,
    patch: Partial<Omit<IntegrationDeliveryProps, 'id' | 'status'>> = {}
  ): IntegrationDelivery {
    if (!this.canTransitionTo(next)) {
      throw new Error(
        `IntegrationDelivery: invalid transition ${this.props.status} -> ${next}`
      )
    }
    return new IntegrationDelivery({ ...this.props, ...patch, status: next })
  }

  isTerminal(): boolean {
    return ALLOWED_TRANSITIONS[this.props.status].length === 0
  }
}
