// StampCampaign — one active per restaurant (DB-enforced via the partial unique
// index uq_stamp_campaigns_one_active). Holds the deal terms a card snapshots at
// creation so a mid-flight edit cannot move a diner's goalposts. Status flow:
// draft → active → paused → active → ended (ended sets a 14-day honor window).

export type StampCampaignStatus = 'draft' | 'active' | 'paused' | 'ended'

const HONOR_WINDOW_DAYS = 14

export interface StampCampaignProps {
  id: string
  restaurantId: string
  name: string
  nameZh: string | null
  stampsRequired: number
  rewardId: string
  status: StampCampaignStatus
  maxStampsPerDay: number
  honorUntil: string | null
}

export interface CreateStampCampaignInput {
  id: string
  restaurantId: string
  name: string
  nameZh?: string | null
  stampsRequired: number
  rewardId: string
  maxStampsPerDay?: number
}

export class StampCampaign {
  private constructor(private readonly props: StampCampaignProps) {}

  static create(input: CreateStampCampaignInput): StampCampaign {
    assertNonEmpty('name', input.name)
    assertNonEmpty('rewardId', input.rewardId)
    assertPositiveInt('stampsRequired', input.stampsRequired)
    const maxPerDay = input.maxStampsPerDay ?? 1
    assertPositiveInt('maxStampsPerDay', maxPerDay)
    return new StampCampaign({
      id: input.id,
      restaurantId: input.restaurantId,
      name: input.name,
      nameZh: input.nameZh ?? null,
      stampsRequired: input.stampsRequired,
      rewardId: input.rewardId,
      status: 'draft',
      maxStampsPerDay: maxPerDay,
      honorUntil: null,
    })
  }

  static fromProps(props: StampCampaignProps): StampCampaign {
    return new StampCampaign(props)
  }

  activate(): StampCampaign {
    if (this.props.status === 'active') return this
    if (this.props.status === 'ended') {
      throw new Error('StampCampaign: cannot activate an ended campaign')
    }
    return this.withStatus('active')
  }

  pause(): StampCampaign {
    return this.withStatus('paused')
  }

  /** End the campaign and open a 14-day grace window for in-progress cards. */
  end(): StampCampaign {
    const honorUntil = new Date(
      Date.now() + HONOR_WINDOW_DAYS * 24 * 60 * 60 * 1000
    ).toISOString()
    return new StampCampaign({ ...this.props, status: 'ended', honorUntil })
  }

  get snapshot(): Readonly<StampCampaignProps> {
    return this.props
  }

  private withStatus(status: StampCampaignStatus): StampCampaign {
    return new StampCampaign({ ...this.props, status })
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`StampCampaign: ${field} is required`)
  }
}

function assertPositiveInt(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`StampCampaign: ${field} must be a positive integer`)
  }
}
