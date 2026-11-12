'use client'

// Network helpers for the owner stamp-campaign CRUD. The route returns typed error
// codes via { error } bodies (NoRewards/RewardNotFound/CapBlocked → friendly statuses;
// OneActiveCampaign → 409 "Pause the running card first."). We surface the raw error
// string so the caller maps it to an i18n key; create also returns the cap `warning`.
export interface CreateStampCampaignBody {
  name: string
  nameZh: string | null
  stampsRequired: number
  rewardId: string
  maxStampsPerDay: number
}

export interface CreateStampCampaignOutcome {
  ok: boolean
  error?: string
  warning?: string
}

export type StampCampaignAction = 'activate' | 'pause' | 'end'

const ENDPOINT = '/api/dashboard/campaigns/stamps'

export async function createStampCampaign(
  body: CreateStampCampaignBody
): Promise<CreateStampCampaignOutcome> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: typeof json.error === 'string' ? json.error : 'save_error' }
  return { ok: true, warning: typeof json.warning === 'string' ? json.warning : undefined }
}

export async function transitionStampCampaign(
  id: string,
  action: StampCampaignAction
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(ENDPOINT, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, action }),
  })
  if (res.ok) return { ok: true }
  const json = await res.json().catch(() => ({}))
  return { ok: false, error: typeof json.error === 'string' ? json.error : 'transition_error' }
}
