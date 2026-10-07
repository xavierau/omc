// StampCard — aggregate root, one in-progress card per (member, campaign). The
// deal terms (stampsRequired, rewardId) are SNAPSHOTTED from the campaign at
// open time so a later campaign edit cannot move a diner's goalposts. stampsCount
// is the read-cache projection of the events ledger; it only moves via increment
// (one stamp) / reverse (one stamp_reversal, floored at 0).

import type { StampCampaign } from './stamp-campaign'

export type StampCardStatus = 'in_progress' | 'completed'

export interface StampCardProps {
  id: string
  restaurantId: string
  memberId: string
  campaignId: string
  stampsCount: number
  stampsRequired: number // snapshot at open
  rewardId: string // snapshot at open
  status: StampCardStatus
}

export interface OpenStampCardInput {
  id: string
  memberId: string
  campaign: StampCampaign
}

export class StampCard {
  private constructor(private readonly props: StampCardProps) {}

  static openFor(input: OpenStampCardInput): StampCard {
    const c = input.campaign.snapshot
    return new StampCard({
      id: input.id,
      restaurantId: c.restaurantId,
      memberId: input.memberId,
      campaignId: c.id,
      stampsCount: 0,
      stampsRequired: c.stampsRequired,
      rewardId: c.rewardId,
      status: 'in_progress',
    })
  }

  static fromProps(props: StampCardProps): StampCard {
    return new StampCard(props)
  }

  get isComplete(): boolean {
    return this.props.status === 'completed'
  }

  increment(): StampCard {
    if (this.props.status === 'completed') {
      throw new Error('StampCard: cannot stamp a completed card')
    }
    const stampsCount = this.props.stampsCount + 1
    const status: StampCardStatus =
      stampsCount >= this.props.stampsRequired ? 'completed' : 'in_progress'
    return new StampCard({ ...this.props, stampsCount, status })
  }

  /**
   * Decrement one stamp; floored at 0; reopens a completed card if it drops below required.
   *
   * NOTE (runtime divergence): the RUNTIME reversal path is the `reverse_stamp` RPC,
   * which only operates on an `in_progress` card and does NOT reopen a `completed`
   * card — the reward coupon is already minted on completion, so re-opening would
   * desync the ledger from the issued reward. The reopen-on-reverse branch below is
   * therefore intentionally NOT exercised at runtime; it is retained for entity
   * completeness/symmetry with `increment` only.
   */
  reverse(): StampCard {
    if (this.props.stampsCount === 0) return this
    const stampsCount = this.props.stampsCount - 1
    const status: StampCardStatus =
      stampsCount >= this.props.stampsRequired ? 'completed' : 'in_progress'
    return new StampCard({ ...this.props, stampsCount, status })
  }

  get snapshot(): Readonly<StampCardProps> {
    return this.props
  }
}
