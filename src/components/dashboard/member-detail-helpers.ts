/**
 * Client-side helper that loads a member's detail from the dashboard API.
 * Isolated from the panel component so vitest (which is configured for
 * `.test.ts` only) can cover the response handling without RTL.
 *
 * A non-ok response resolves to null — a 404 body is `{ error: string }`,
 * which is truthy and, if handed to the panel as a "member", crashes the
 * receipts renderer (#111 review finding). Null renders the panel's
 * not-found state instead.
 */
export async function fetchMemberDetail<T>(memberId: string): Promise<T | null> {
  const res = await fetch(`/api/dashboard/members?id=${memberId}`)
  if (!res.ok) return null
  return (await res.json()) as T
}
