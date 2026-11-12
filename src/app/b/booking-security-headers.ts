/**
 * BOOK-001 R7: the booking page and its submit API carry a bearer token in
 * the URL, so neither may be cached by an edge or proxy, leak through a
 * Referer header, or be indexed. Applied to `/b/*` by next.config.ts
 * `headers()` and set explicitly on every `/api/b/*` response.
 */
export const BOOKING_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'Cache-Control', value: 'no-store, max-age=0' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
]

export function bookingHeaderRules() {
  const headers = [...BOOKING_SECURITY_HEADERS]
  return [
    { source: '/b/:path*', headers },
    { source: '/api/b/:path*', headers },
  ]
}

export function applyBookingHeaders<T extends { headers: Headers }>(response: T): T {
  for (const { key, value } of BOOKING_SECURITY_HEADERS) response.headers.set(key, value)
  return response
}
