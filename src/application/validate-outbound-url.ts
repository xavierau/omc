// INT-001 T-M6: the URL validator shared by the settings save path (WI-8)
// and the delivery-attempt pre-check (WI-6) -- ONE application-layer
// function, never duplicated in the React form (T-C4's mitigation names
// this exact requirement). Delegates the actual rules to
// `src/infrastructure/http/ssrf-guard.ts`, the same guard
// `UndiciOutboundSender` enforces internally on every delivery attempt.

import { assertSafeUrl, resolveAndPin, type ResolveAndPinDeps } from '@/infrastructure/http/ssrf-guard'

export type ValidateOutboundUrlResult =
  | { ok: true }
  | { ok: false; error: { title: string; details: string } }

export async function validateOutboundUrl(
  rawUrl: string,
  deps: ResolveAndPinDeps = {}
): Promise<ValidateOutboundUrlResult> {
  const safe = assertSafeUrl(rawUrl)
  if (!safe.ok) return { ok: false, error: safe.error }

  const pin = await resolveAndPin(safe.hostname, deps)
  if (!pin.ok) return { ok: false, error: pin.error }

  return { ok: true }
}
