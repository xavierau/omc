'use client'

// INT-001 WI-9 — network helpers for the dashboard Integrations area. Every
// mutating call goes through `src/app/api/dashboard/pos-integrations/**`
// (WI-0/WI-8, frozen contracts — see artifacts/2026-09-10-int-001-wi8-backend
// and artifacts/2026-09-10-int-001-wi0-backend). Response envelopes are
// copied verbatim from those routes: list/detail/settings GET and settings
// PATCH wrap the payload in `{ data }` (PATCH also carries `warnings`); the
// outbound-secret PUT, rotate-inbound-secret POST and outbound/test POST do
// NOT use a `{ data }` envelope — matches each route file exactly.

export interface PublicIntegration {
  id: string
  restaurantId: string
  provider: string
  name: string
  status: 'active' | 'inactive'
  fieldMapping: Record<string, unknown> | null
  secretLast4: string | null
  createdAt: string
  updatedAt: string
}

export type TemplateCategory = 'MARKETING' | 'UTILITY'

export interface ResolvedTemplateView {
  name: string
  category: TemplateCategory
}

export type OutboundStatus = 'active' | 'paused_auto' | 'paused_manual'
export type OutboundEventName = 'member.created' | 'member.updated'

export interface IntegrationSettingsView {
  newJoinTemplateId: string | null
  resolvedTemplate: ResolvedTemplateView | null
  consentAttestationText: string | null
  consentAttestationAckAt: string | null
  outboundUrl: string | null
  outboundEvents: OutboundEventName[]
  outboundEnabled: boolean
  outboundPiiAckAt: string | null
  outboundStatus: OutboundStatus
  outboundFailureStreak: number
  outboundPausedAt: string | null
  outboundSecretLast4: string | null
  outboundSecretUpdatedAt: string | null
}

export interface SettingsPatchInput {
  newJoinTemplateId?: string | null
  consentAttestationText?: string | null
  consentAttestationAck?: boolean
  outboundUrl?: string
  outboundEvents?: OutboundEventName[]
  outboundEnabled?: boolean
  outboundPiiAck?: boolean
}

/** Union of every settings-route error code: the 400 field/shape validators
 * (`integration-settings-validators.ts`) and the 422 business-rule codes
 * (`update-integration-settings.ts`'s `SettingsErrorCode`). Both surface as
 * `{ error: <code> }` on the wire — only the HTTP status differs — so a
 * single result type covers both, and `'network_error'` covers a thrown
 * fetch. Unrecognized strings still flow through as-is; the presentation
 * layer's `settingsErrorMessageKey` falls back to a generic message for any
 * code this list doesn't name, so a future backend code never crashes the UI. */
export type SettingsSaveErrorCode =
  | 'unknown_field'
  | 'invalid_body'
  | 'invalid_new_join_template_id'
  | 'invalid_consent_attestation_text'
  | 'invalid_consent_attestation_ack'
  | 'invalid_outbound_url'
  | 'invalid_outbound_events'
  | 'invalid_outbound_enabled'
  | 'invalid_outbound_pii_ack'
  | 'template_not_found'
  | 'template_not_approved'
  | 'template_not_owned'
  | 'no_default_welcome_template'
  | 'url_not_https'
  | 'url_private_address'
  | 'url_invalid'
  | 'url_port'
  | 'url_userinfo'
  | 'pii_ack_required'
  | 'network_error'
  | (string & {})

export type SettingsPatchResult =
  | { ok: true; settings: IntegrationSettingsView; warnings: string[] }
  | { ok: false; error: SettingsSaveErrorCode }

export type ListIntegrationsResult =
  | { ok: true; integrations: PublicIntegration[] }
  | { ok: false; error: string }

export type DetailResult =
  | { ok: true; integration: PublicIntegration }
  | { ok: false; status: number; error: string }

export type SettingsResult =
  | { ok: true; settings: IntegrationSettingsView }
  | { ok: false; status: number; error: string }

export type CreateIntegrationResult =
  | { ok: true; id: string; webhookUrl: string; webhookSecret: string }
  | { ok: false; error: string }

export type SecretSaveResult =
  | { ok: true; last4: string; updatedAt: string }
  | { ok: false; error: 'secret_too_short' | 'network_error' | (string & {}) }

export type RotateSecretResult =
  | { ok: true; webhookSecret: string }
  | { ok: false; error: string }

export type TestEventResult =
  | { ok: true; deliveryId: string }
  | { ok: false; status: number; error: 'url_not_saved' | 'not_eligible_for_delivery' | 'integration_not_found' | 'network_error' | (string & {}) }

// INT-001 WI-10 — additive extension of WI-9's client (delivery log,
// activity log, retry, resume). Response envelopes copied verbatim from
// WI-8's routes (see artifacts/2026-09-10-int-001-wi8-backend): the
// deliveries/activity GETs wrap `{ data, nextCursor }`; retry POST returns
// `{ status: 'ok' }` on 202 (this client only needs `ok: true`, not the
// body); resume POST returns `{ requeued }` on 200 with no envelope.

export type IntegrationDeliveryStatus =
  | 'queued'
  | 'delivering'
  | 'retrying'
  | 'delivered'
  | 'dead_lettered'
  | 'paused'
  | 'skipped'

export interface IntegrationDeliveryListItem {
  id: string
  eventId: string
  eventType: string | null
  occurredAt: string | null
  status: IntegrationDeliveryStatus
  attempts: number
  lastHttpStatus: number | null
  lastErrorCode: string | null
  nextRetryAt: string | null
  createdAt: string
}

export type ListDeliveriesResult =
  | { ok: true; data: IntegrationDeliveryListItem[]; nextCursor: string | null }
  | { ok: false; status: number; error: string }

export async function fetchIntegrationDeliveries(
  id: string,
  args: { status?: IntegrationDeliveryStatus; cursor?: string } = {}
): Promise<ListDeliveriesResult> {
  try {
    const params = new URLSearchParams()
    if (args.status) params.set('status', args.status)
    if (args.cursor) params.set('cursor', args.cursor)
    const qs = params.toString()
    const res = await fetch(`/api/dashboard/pos-integrations/${id}/deliveries${qs ? `?${qs}` : ''}`)
    if (!res.ok) return { ok: false, status: res.status, error: await readError(res) }
    const json = await res.json()
    return { ok: true, data: Array.isArray(json.data) ? json.data : [], nextCursor: json.nextCursor ?? null }
  } catch {
    return { ok: false, status: 0, error: 'network_error' }
  }
}

export type RetryDeliveryApiResult =
  | { ok: true }
  | { ok: false; status: number; error: 'already_retried' | 'not_found' | 'network_error' | (string & {}) }

export async function retryDeliveryRequest(id: string, deliveryId: string): Promise<RetryDeliveryApiResult> {
  try {
    const res = await fetch(`/api/dashboard/pos-integrations/${id}/deliveries/${deliveryId}/retry`, {
      method: 'POST',
    })
    if (!res.ok) return { ok: false, status: res.status, error: await readError(res) }
    return { ok: true }
  } catch {
    return { ok: false, status: 0, error: 'network_error' }
  }
}

export type MemberJobStatus = 'queued' | 'processing' | 'succeeded' | 'failed'
export type MemberJobOutcome = 'created' | 'existing'
export type AssertedConsentLevel = 'none' | 'utility' | 'all'

export interface IntegrationActivityItem {
  jobId: string
  status: MemberJobStatus
  outcome: MemberJobOutcome | null
  assertedLevel: AssertedConsentLevel
  consentActions: Record<string, unknown> | null
  welcomeOutcome: string | null
  welcomeDetail: Record<string, unknown> | null
  phoneLast4: string
  submittedAt: string
}

export type ListActivityResult =
  | { ok: true; data: IntegrationActivityItem[]; nextCursor: string | null }
  | { ok: false; status: number; error: string }

export async function fetchIntegrationActivity(
  id: string,
  args: { cursor?: string } = {}
): Promise<ListActivityResult> {
  try {
    const qs = args.cursor ? `?cursor=${encodeURIComponent(args.cursor)}` : ''
    const res = await fetch(`/api/dashboard/pos-integrations/${id}/activity${qs}`)
    if (!res.ok) return { ok: false, status: res.status, error: await readError(res) }
    const json = await res.json()
    return { ok: true, data: Array.isArray(json.data) ? json.data : [], nextCursor: json.nextCursor ?? null }
  } catch {
    return { ok: false, status: 0, error: 'network_error' }
  }
}

export type ResumeOutboundApiResult =
  | { ok: true; requeued: number }
  | { ok: false; status: number; error: 'url_invalid' | 'integration_not_found' | 'network_error' | (string & {}) }

export async function resumeOutboundRequest(id: string): Promise<ResumeOutboundApiResult> {
  try {
    const res = await fetch(`/api/dashboard/pos-integrations/${id}/outbound/resume`, { method: 'POST' })
    if (!res.ok) return { ok: false, status: res.status, error: await readError(res) }
    const json = await res.json()
    return { ok: true, requeued: typeof json.requeued === 'number' ? json.requeued : 0 }
  } catch {
    return { ok: false, status: 0, error: 'network_error' }
  }
}

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null)
  const error = body && typeof body === 'object' ? (body as Record<string, unknown>).error : undefined
  return typeof error === 'string' ? error : 'network_error'
}

export async function fetchIntegrations(): Promise<ListIntegrationsResult> {
  try {
    const res = await fetch('/api/dashboard/pos-integrations')
    if (!res.ok) return { ok: false, error: await readError(res) }
    const json = await res.json()
    return { ok: true, integrations: Array.isArray(json.data) ? json.data : [] }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}

export async function createIntegrationRequest(name: string): Promise<CreateIntegrationResult> {
  try {
    const res = await fetch('/api/dashboard/pos-integrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) return { ok: false, error: await readError(res) }
    const json = await res.json()
    return { ok: true, id: json.data.id, webhookUrl: json.data.webhookUrl, webhookSecret: json.data.webhookSecret }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}

export async function fetchIntegrationDetail(id: string): Promise<DetailResult> {
  try {
    const res = await fetch(`/api/dashboard/pos-integrations/${id}`)
    if (!res.ok) return { ok: false, status: res.status, error: await readError(res) }
    const json = await res.json()
    return { ok: true, integration: json.data }
  } catch {
    return { ok: false, status: 0, error: 'network_error' }
  }
}

export async function fetchIntegrationSettings(id: string): Promise<SettingsResult> {
  try {
    const res = await fetch(`/api/dashboard/pos-integrations/${id}/settings`)
    if (!res.ok) return { ok: false, status: res.status, error: await readError(res) }
    const json = await res.json()
    return { ok: true, settings: json.data }
  } catch {
    return { ok: false, status: 0, error: 'network_error' }
  }
}

export async function patchIntegrationSettings(id: string, patch: SettingsPatchInput): Promise<SettingsPatchResult> {
  try {
    const res = await fetch(`/api/dashboard/pos-integrations/${id}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) return { ok: false, error: await readError(res) }
    const json = await res.json()
    return { ok: true, settings: json.data, warnings: Array.isArray(json.warnings) ? json.warnings : [] }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}

export async function putOutboundSecret(id: string, secret: string): Promise<SecretSaveResult> {
  try {
    const res = await fetch(`/api/dashboard/pos-integrations/${id}/outbound-secret`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret }),
    })
    if (!res.ok) return { ok: false, error: await readError(res) }
    const json = await res.json()
    return { ok: true, last4: json.last4, updatedAt: json.updatedAt }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}

export async function rotateInboundSecretRequest(id: string): Promise<RotateSecretResult> {
  try {
    const res = await fetch(`/api/dashboard/pos-integrations/${id}/rotate-inbound-secret`, { method: 'POST' })
    if (!res.ok) return { ok: false, error: await readError(res) }
    const json = await res.json()
    return { ok: true, webhookSecret: json.webhookSecret }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}

export async function sendTestEventRequest(id: string): Promise<TestEventResult> {
  try {
    const res = await fetch(`/api/dashboard/pos-integrations/${id}/outbound/test`, { method: 'POST' })
    if (!res.ok) return { ok: false, status: res.status, error: await readError(res) }
    const json = await res.json()
    return { ok: true, deliveryId: json.deliveryId }
  } catch {
    return { ok: false, status: 0, error: 'network_error' }
  }
}

/** Derives admin-vs-staff from the same `user_tenants.role` the API guards
 * enforce (`requireTenantAdmin`, `role === 'admin'` allowlist) — sourced
 * from `useTenant()`'s own `restaurants` list (`/api/me/tenants` already
 * returns `role` per tenant), so no extra endpoint or provider change is
 * needed to know it client-side. */
export function isTenantAdmin(
  restaurants: Array<{ id: string; role: string }>,
  restaurantId: string | null
): boolean {
  if (!restaurantId) return false
  return restaurants.find((r) => r.id === restaurantId)?.role === 'admin'
}
