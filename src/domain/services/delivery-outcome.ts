// INT-001: pure classification of one outbound webhook delivery attempt
// (§"Outbound" step 5). The delivery processor (WI-6) maps 'permanent' to
// `UnrecoverableError` (BullMQ, -> dead_lettered) and 'transient' to a plain
// `Error` (-> retried, honouring `Retry-After` on 429 via `moveToDelayed`).

import type { DeliveryResult } from '../ports/outbound-webhook-sender'

export type DeliveryOutcome = 'delivered' | 'permanent' | 'transient'

// Error titles the sender/guard layer (WI-5/WI-6) is expected to use for a
// DeliveryResult that never reached an HTTP status (no request was made, or
// the connection never completed).
const PERMANENT_ERROR_TITLES = new Set([
  'ssrf_rejected',
  'invalid_url',
  'signature_missing',
  'secret_missing',
])
const TRANSIENT_ERROR_TITLES = new Set([
  'timeout',
  'dns_error',
  'connection_reset',
  'network_error',
])

export function classifyDeliveryOutcome(result: DeliveryResult): DeliveryOutcome {
  if (result.status !== null) {
    if (result.status >= 200 && result.status < 300) return 'delivered'
    if (result.status === 408 || result.status === 429) return 'transient'
    if (result.status >= 500) return 'transient'
    // 3xx and 4xx other than 408/429.
    return 'permanent'
  }

  const title = result.error?.title
  if (title && PERMANENT_ERROR_TITLES.has(title)) return 'permanent'
  if (title && TRANSIENT_ERROR_TITLES.has(title)) return 'transient'

  // Unknown/unrecognised failure shape with no HTTP status: fail closed
  // toward retrying rather than silently dead-lettering on a classification
  // gap -- a genuinely permanent condition will keep producing the same
  // result and exhaust retries anyway; a transient one that got
  // misclassified as permanent would be lost forever.
  return 'transient'
}
