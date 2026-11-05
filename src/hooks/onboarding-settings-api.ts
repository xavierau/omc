import type {
  OnboardingSettings,
  OnboardingPatch,
} from '@/domain/onboarding/onboarding-settings'

export const ONBOARDING_SETTINGS_ENDPOINT = '/api/admin/onboarding-settings'

export async function fetchOnboardingSettings(): Promise<OnboardingSettings> {
  const res = await fetch(ONBOARDING_SETTINGS_ENDPOINT)
  if (!res.ok) {
    throw new Error(`Failed to fetch onboarding settings (${res.status})`)
  }
  return (await res.json()) as OnboardingSettings
}

export async function patchOnboardingSettings(patch: OnboardingPatch): Promise<OnboardingSettings> {
  const res = await fetch(ONBOARDING_SETTINGS_ENDPOINT, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    throw new Error(`Failed to save onboarding settings (${res.status})`)
  }
  return (await res.json()) as OnboardingSettings
}
