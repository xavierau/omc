/**
 * Outcome of turning an uploaded image into a Meta resumable-upload handle.
 *
 * Mirrors the flat Result shape of {@link ./send-result} and
 * {@link ./template-submit-result}: the three failure modes must stay distinct
 * because the caller reacts to each differently —
 * - `meta_not_configured` — a SKIP: no Meta app credentials, nothing was
 *   attempted; the template stays a draft, never branded a failure.
 * - `fetch_failed` — the source image URL could not be read; the operator's
 *   own storage is the problem, not Meta.
 * - `upload_failed` — Meta's resumable-upload API refused or errored; retryable.
 */
export type MediaHandleErrorTitle =
  | 'meta_not_configured'
  | 'fetch_failed'
  | 'upload_failed'

export interface MediaHandleResult {
  ok: boolean
  handle: string | null
  error?: { title: MediaHandleErrorTitle; details?: string }
}
