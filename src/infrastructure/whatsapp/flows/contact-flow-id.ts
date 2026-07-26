/**
 * Resolves the shared WhatsApp Flow id used for the contact-us form (REPLY-005,
 * AD-3). One Flow, deployed once per WABA and referenced via env — NOT
 * per-tenant data, so it does not live in the database.
 *
 * This is deliberately the ONLY place in the codebase that reads
 * `WHATSAPP_CONTACT_FLOW_ID`. WhatsApp Flows are scoped to a WABA, and
 * `restaurants.meta_business_account_id` is per-restaurant — if tenants ever
 * span multiple WABAs, a single global flow id is wrong and this would need
 * to become a per-WABA lookup. Isolating the env read to one function keeps
 * that future change contained to this file.
 */
export function resolveContactFlowId(): string | null {
  const raw = process.env.WHATSAPP_CONTACT_FLOW_ID
  if (!raw) return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}
