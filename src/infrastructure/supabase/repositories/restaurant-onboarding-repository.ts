import { createServerSupabaseClient } from '../client'

export interface OnboardingSettings {
  welcomeCampaignId: string | null
  returningMemberTemplate: string | null
}

export async function getOnboardingSettings(
  restaurantId: string
): Promise<OnboardingSettings> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select('welcome_campaign_id, returning_member_template')
    .eq('id', restaurantId)
    .single()

  if (error || !data) {
    throw new Error(
      `getOnboardingSettings: restaurant not found (${restaurantId})`
    )
  }

  return {
    welcomeCampaignId: (data.welcome_campaign_id as string | null) ?? null,
    returningMemberTemplate:
      (data.returning_member_template as string | null) ?? null,
  }
}

export async function updateOnboardingSettings(
  restaurantId: string,
  changes: Partial<OnboardingSettings>
): Promise<void> {
  const update: Record<string, unknown> = {}
  if (changes.welcomeCampaignId !== undefined) {
    update.welcome_campaign_id = changes.welcomeCampaignId
  }
  if (changes.returningMemberTemplate !== undefined) {
    update.returning_member_template = changes.returningMemberTemplate
  }
  if (Object.keys(update).length === 0) return

  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('restaurants')
    .update(update)
    .eq('id', restaurantId)

  if (error) {
    throw new Error(`updateOnboardingSettings: ${error.message}`)
  }
}
