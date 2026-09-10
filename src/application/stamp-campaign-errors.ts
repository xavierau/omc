// Typed application errors for the owner stamp-campaign CRUD use cases. The route
// layer maps each to a friendly HTTP status/body (plan §9). Kept in one small file
// so use cases and routes share the exact same error identities.

/** Restaurant has zero rewards — cannot create a stamp campaign (Story 1 AC). */
export class NoRewardsError extends Error {
  constructor() {
    super('Create a reward first — a stamp campaign needs a reward to give out.')
    this.name = 'NoRewardsError'
  }
}

/** The chosen reward_id does not exist in this restaurant's catalog. */
export class RewardNotFoundError extends Error {
  constructor() {
    super('That reward does not exist for this restaurant.')
    this.name = 'RewardNotFoundError'
  }
}

/** The cap policy is 'block' and max_stamps_per_day exceeds the warn threshold. */
export class CapBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CapBlockedError'
  }
}

/** A stamp campaign was not found for this tenant (id/restaurant mismatch). */
export class StampCampaignNotFoundError extends Error {
  constructor() {
    super('Stamp campaign not found.')
    this.name = 'StampCampaignNotFoundError'
  }
}
