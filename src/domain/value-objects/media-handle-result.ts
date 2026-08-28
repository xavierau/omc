/**
 * Outcome of turning an uploaded image into a Meta resumable-upload handle.
 *
 * Kapso's Platform Media API mints the handle server-side from a public URL, so
 * the three failure modes stay distinct because the caller reacts to each
 * differently —
 * - `not_configured` — a SKIP: no Kapso API key (or no phone number to bind the
 *   upload to); nothing was attempted, the template stays a draft.
 * - `fetch_failed` — the source URL is unusable (not an allowed storage URL);
 *   the operator's own input is the problem, not the provider.
 * - `upload_failed` — Kapso/Meta refused or errored while minting; retryable.
 */
export type MediaHandleErrorTitle =
  | 'not_configured'
  | 'fetch_failed'
  | 'upload_failed'

export interface MediaHandleResult {
  ok: boolean
  handle: string | null
  error?: { title: MediaHandleErrorTitle; details?: string }
}
