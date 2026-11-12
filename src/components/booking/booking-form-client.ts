/**
 * BOOK-001: the booking page's submit call and how each API answer maps to
 * what the diner sees (spec UI Feedback States). Pure apart from `fetch`.
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

export function outcomeFromResponse(status: number, body: unknown): BookingSubmitOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as { fields?: Record<string, string>; state?: string }
  if (status === 200) return { kind: 'sent' }
  if (status === 400 && b.fields) return { kind: 'fields', errors: b.fields }
  if (status === 410) return { kind: 'gone', state: b.state ?? 'unknown' }
  if (status === 409) return { kind: 'too_many' }
  if (status === 429) return { kind: 'rate_limited' }
  return { kind: 'error' }
}

export async function postBooking(token: string, values: BookingFormValues): Promise<BookingSubmitOutcome> {
  try {
    const res = await fetch(`/api/b/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, notes: values.notes.trim() === '' ? null : values.notes }),
    })
    return outcomeFromResponse(res.status, await res.json().catch(() => null))
  } catch {
    return { kind: 'error' }
  }
}
