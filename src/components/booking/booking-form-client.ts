/**
 * BOOK-001: the booking page's submit call and how each API answer maps to
 * what the diner sees (spec UI Feedback States). Pure apart from `fetch`.
 * BOOK-014 W3: a deposit hold answers a /p redirect (followed only when it is
 * our own /p path); a provider failure answers 503 payment_unavailable.
 */
export interface BookingFormValues {
  date: string
  time: string
  partySize: string
  name: string
  notes: string
}

export type BookingSubmitOutcome =
  | { kind: 'sent' }
  | { kind: 'fields'; errors: Record<string, string> }
  | { kind: 'gone'; state: string }
  | { kind: 'too_many' }
  | { kind: 'rate_limited' }
  | { kind: 'error' }
  /** BOOK-014 W3: held awaiting the deposit; go to the /p link. */
  | { kind: 'redirect'; url: string }
  | { kind: 'payment_unavailable' }

/** BOOK-014 W3: only an http(s) URL whose path is our /p/<token> link is followed. */
export function isPaymentRedirect(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && /^\/p\/[A-Za-z0-9_-]+$/.test(parsed.pathname)
  } catch {
    return false
  }
}

export function outcomeFromResponse(status: number, body: unknown): BookingSubmitOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as { fields?: Record<string, string>; state?: string; redirect?: unknown; error?: string }
  if (status === 200 && b.redirect !== undefined) {
    return typeof b.redirect === 'string' && isPaymentRedirect(b.redirect) ? { kind: 'redirect', url: b.redirect } : { kind: 'error' }
  }
  if (status === 200) return { kind: 'sent' }
  if (status === 503 && b.error === 'payment_unavailable') return { kind: 'payment_unavailable' }
  if (status === 400 && b.fields) return { kind: 'fields', errors: b.fields }
  if (status === 410) return { kind: 'gone', state: b.state ?? 'unknown' }
  if (status === 409) return { kind: 'too_many' }
  if (status === 429) return { kind: 'rate_limited' }
  return { kind: 'error' }
}

/** BOOK-009: `acceptTerms` is sent only by the slot form, when the restaurant set terms. */
export async function postBooking(token: string, values: BookingFormValues, extra: { acceptTerms?: boolean } = {}): Promise<BookingSubmitOutcome> {
  try {
    const res = await fetch(`/api/b/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, notes: values.notes.trim() === '' ? null : values.notes, ...extra }),
    })
    return outcomeFromResponse(res.status, await res.json().catch(() => null))
  } catch {
    return { kind: 'error' }
  }
}
