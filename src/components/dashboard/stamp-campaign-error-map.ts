// Maps a server error string from the stamp-campaign CRUD route to a key in the
// 'stampCampaigns' i18n namespace. The route returns the typed error's .message
// (English); matching on a stable substring keeps the UI localized without coupling to
// the exact wording. Unknown errors fall back to a generic save/transition key.
export function mapCreateError(error: string | undefined): string {
  if (!error) return 'saveError'
  if (/reward/i.test(error) && /first|create/i.test(error)) return 'errorNoRewards'
  if (/reward/i.test(error)) return 'errorRewardNotFound'
  if (/per day|stamps to|plan limits|cap/i.test(error)) return 'errorCapBlocked'
  return 'saveError'
}

export function mapTransitionError(error: string | undefined): string {
  if (!error) return 'transitionError'
  if (/pause the running/i.test(error)) return 'errorOneActive'
  return 'transitionError'
}
