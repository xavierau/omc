/**
 * The public app URL every customer-facing link is built on (Book now and
 * coupon buttons, booking links). NEXT_PUBLIC_, so the same value is inlined
 * in the dashboard bundle that builds template buttons and read on the server
 * that sends them; both sides must agree for the Book now button to be found.
 */
export function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? ''
}
