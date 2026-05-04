import crypto from 'crypto'

export interface ConversationWindowProps {
  id: string
  restaurantId: string
  phoneE164: string
  // Stable for the window's lifetime — set when the window first opens.
  openedAt: string
  // Bumped on every inbound while the window is still open.
  lastInboundAt: string
  // 24h from the most recent inbound (or whatever windowHours is passed).
  expiresAt: string
}

export interface OpenInput {
  restaurantId: string
  phoneE164: string
  now?: Date
  windowHours?: number
}

const DEFAULT_WINDOW_HOURS = 24

/**
 * A WhatsApp 24h customer-service window for one (restaurant, phone). While
 * the window is open the business may send free-form (service) messages
 * instead of paid templates. Persisted to `conversation_windows` via the
 * repository; bumped on every inbound message.
 *
 * Immutable: `bumpInbound` returns a NEW instance.
 */
export class ConversationWindow {
  private constructor(private readonly props: ConversationWindowProps) {}

  static open(input: OpenInput): ConversationWindow {
    assertNonEmpty('restaurantId', input.restaurantId)
    assertNonEmpty('phoneE164', input.phoneE164)
    const opened = (input.now ?? new Date()).toISOString()
    const expires = addHoursIso(opened, input.windowHours ?? DEFAULT_WINDOW_HOURS)
    return new ConversationWindow({
      id: crypto.randomUUID(),
      restaurantId: input.restaurantId,
      phoneE164: input.phoneE164,
      openedAt: opened,
      lastInboundAt: opened,
      expiresAt: expires,
    })
  }

  static fromProps(props: ConversationWindowProps): ConversationWindow {
    return new ConversationWindow(props)
  }

  /**
   * Returns a new instance with bumped `lastInboundAt` and extended
   * `expiresAt`. `openedAt` and `id` are preserved — same logical window.
   */
  bumpInbound(now?: Date, windowHours?: number): ConversationWindow {
    const at = (now ?? new Date()).toISOString()
    const expires = addHoursIso(at, windowHours ?? DEFAULT_WINDOW_HOURS)
    return new ConversationWindow({
      ...this.props,
      lastInboundAt: at,
      expiresAt: expires,
    })
  }

  isOpenAt(when: Date): boolean {
    return when.getTime() < Date.parse(this.props.expiresAt)
  }

  get snapshot(): Readonly<ConversationWindowProps> {
    return this.props
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`ConversationWindow: ${field} is required`)
  }
}

function addHoursIso(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString()
}
