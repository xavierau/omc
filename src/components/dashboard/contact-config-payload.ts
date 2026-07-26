import { validateContactConfig, type ContactMode } from '@/domain/services/contact-config'

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
 * included (see route contract). A redirect-mode tenant who never touched
 * the topic inputs sends `[]` — the "omitted" shape `validateContactConfig`
 * accepts outside form mode — rather than five blank strings, which would
 * fail its shape check.
 */
export function buildContactConfigPayload(state: ContactFormState): ContactConfigPayload {
  const trimmedTopics = state.topics.map((topic) => topic.trim())
  const topicsUntouched = state.mode === 'redirect' && trimmedTopics.every((topic) => topic === '')
  return {
    mode: state.mode,
    notificationEmail: state.notificationEmail.trim() || null,
    topics: topicsUntouched ? [] : trimmedTopics,
    ackText: state.ackText.trim() || null,
  }
}
