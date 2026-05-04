import type { SendResult } from '@/infrastructure/whatsapp/messaging-result'

/** Test helper: an OK SendResult with a deterministic wamid. */
export function okResult(id = 'wamid.test'): SendResult {
  return { ok: true, kapsoMessageId: id, raw: null }
}

/** Test helper: a non-OK SendResult with a synthetic error title. */
export function failResult(title = 'test_skip'): SendResult {
  return {
    ok: false,
    kapsoMessageId: null,
    raw: null,
    error: { title },
  }
}
