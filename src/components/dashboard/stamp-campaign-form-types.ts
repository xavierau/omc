import type { CreateStampCampaignBody } from '@/hooks/stamp-campaign-client'

export interface StampCampaignFormState {
  name: string
  nameZh: string
  stampsRequired: string
  rewardId: string
  maxStampsPerDay: string
}

export const initialStampCampaignForm: StampCampaignFormState = {
  name: '',
  nameZh: '',
  stampsRequired: '10',
  rewardId: '',
  maxStampsPerDay: '1',
}

// Returns an i18n key (in the 'stampCampaigns' namespace) for the first invalid field,
// or null when the form is valid. Mirrors validateCampaignForm's contract.
export function validateStampCampaignForm(form: StampCampaignFormState): string | null {
  if (!form.name.trim()) return 'formName'
  if (!isPositiveInt(form.stampsRequired)) return 'formStampsRequired'
  if (!form.rewardId) return 'formReward'
  if (!isPositiveInt(form.maxStampsPerDay)) return 'formMaxPerDay'
  return null
}

export function buildStampCampaignBody(form: StampCampaignFormState): CreateStampCampaignBody {
  return {
    name: form.name.trim(),
    nameZh: form.nameZh.trim() || null,
    stampsRequired: Number(form.stampsRequired),
    rewardId: form.rewardId,
    maxStampsPerDay: Number(form.maxStampsPerDay),
  }
}

function isPositiveInt(value: string): boolean {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1
}
