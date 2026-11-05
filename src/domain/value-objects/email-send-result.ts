/**
 * Outcome of an email send call. Mirrors `SendResult` in spirit
 * (`src/domain/value-objects/send-result.ts`) with `providerMessageId` in
 * place of `kapsoMessageId`.
 *
 * A Result type, never `T | null` — a nullable return would collapse
 * skip / rejection / transient failure into one indistinguishable case
 * (see the TPL-003 lesson). Adapters that legitimately skip the network
 * (e.g. missing API key) return `ok=false` with `error.title` describing
 * the skip reason; `ok=true` requires a non-null `providerMessageId`.
 */
export interface EmailSendResult {
  ok: boolean
  providerMessageId: string | null
  raw: Record<string, unknown> | null
  error?: { title: string; details?: string }
}
