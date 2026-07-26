import { validateContactConfig, DEFAULT_TOPICS, type ContactMode } from '@/domain/services/contact-config'

export interface ContactFormState {
  mode: ContactMode
  notificationEmail: string
  topics: string[]
  ackText: string
}

export interface ContactConfigPayload {
  mode: ContactMode
  notificationEmail: string | null
  topics: string[]
  ackText: string | null
}

/**
 * Client-side gate mirroring the server validator exactly: builds the same
 * PATCH payload `save()` would send and runs it through the domain's own
 * `validateContactConfig` (email format, topic count/duplicates/length —
 * form mode only — and ackText length), rather than re-typing a subset of
 * those rules here. Two divergent copies of the same rule is how partial
 * saves (redirect succeeds, contact-config 400s) happen.
 */
export function canSaveContactConfig(state: ContactFormState): boolean {
  return contactConfigValidationError(state) === null
}

/** Same gate as `canSaveContactConfig`, but returns the domain's error string (or null) so the caller can show *why*. */
export function contactConfigValidationError(state: ContactFormState): string | null {
  const result = validateContactConfig(buildContactConfigPayload(state))
  return result.ok ? null : result.error
}

/**
 * Shapes the full PATCH body for `/api/dashboard/settings/contact-config`.
 * The route full-replaces the stored object, so all four keys are always
 * included (see route contract). Topics are only ever edited through the
 * UI while `mode === 'form'` (the topic inputs aren't rendered otherwise),
 * so any topics value left over in redirect mode is stale leftover state
 * from a prior form-mode edit, not an intentional entry — sending it would
 * either fail `validateContactConfig`'s shape check (partial/duplicate
 * entries) or silently persist topics the admin can no longer see or edit.
 * Redirect mode therefore always sends `[]`, the "omitted" shape
 * `validateContactConfig` accepts outside form mode, regardless of what's
 * still sitting in the (hidden) topic inputs.
 */
export function buildContactConfigPayload(state: ContactFormState): ContactConfigPayload {
  const topics = state.mode === 'redirect' ? [] : state.topics.map((topic) => topic.trim())
  return {
    mode: state.mode,
    notificationEmail: state.notificationEmail.trim() || null,
    topics,
    ackText: state.ackText.trim() || null,
  }
}

/**
 * Field-level email validity for the inline indicator (aria-invalid + Save
 * disable) on the notification-email input. Isolates the email rule inside
 * `validateContactConfig` by holding topics/ackText at known-valid values,
 * so a blank OR malformed email is the only thing that can make it fail —
 * reusing the domain's email format check rather than re-typing the regex
 * here, the same divergent-copy bug class this file's payload builder was
 * already written to avoid.
 */
export function isContactEmailInvalid(mode: ContactMode, notificationEmail: string): boolean {
  if (mode !== 'form') return false
  return !validateContactConfig({
    mode: 'form',
    notificationEmail: notificationEmail.trim() || null,
    topics: DEFAULT_TOPICS,
    ackText: null,
  }).ok
}
