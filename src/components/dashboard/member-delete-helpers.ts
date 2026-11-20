/**
 * Client-side helper that fires a DELETE against the member endpoint.
 * Isolated from the panel component so vitest (which is configured for
 * `.test.ts` only) can cover the request/error shape without RTL.
 */
export async function performMemberDelete(memberId: string): Promise<void> {
  const res = await fetch(`/api/dashboard/members/${memberId}`, {
    method: 'DELETE',
  })

  if (!res.ok) {
    // Prefer the server-provided error message (the route returns
    // `{ error: string }` on 4xx/5xx). Fall back to a status-based
    // label when the body is missing or not JSON so the caller still
    // gets something actionable.
    let message = `Delete failed with status ${res.status}`
    try {
      const body = (await res.json()) as { error?: unknown }
      if (body && typeof body.error === 'string' && body.error.length > 0) {
        message = body.error
      }
    } catch {
      /* response wasn't JSON — keep the status-based fallback */
    }
    throw new Error(message)
  }
}
