// INT-001: wire types for the partner member-creation API. Verbatim from
// plan §"API Contracts" -- WI-3 (routes/validators) and WI-11 (docs) both
// read these types directly; a docs test (WI-11) imports this file and
// checks every documented field name exists here.

export type ConsentLevelWire = 'none' | 'utility' | 'all'
export type LanguageWire = 'en' | 'zh-HK'

export interface CreateMemberRequestBody {
  phone: string
  consent_level: ConsentLevelWire
  name?: string
  external_ref?: string
  language?: LanguageWire
  send_welcome?: boolean
  metadata?: Record<string, unknown>
}

export interface CreateMemberAcceptedResponse {
  job_id: string
  status: 'queued' | 'processing'
  poll_url: string
}

export type CreateMemberValidationCode =
  | 'required'
  | 'invalid_type'
  | 'invalid_e164'
  | 'invalid_enum'
  | 'too_long'
  | 'too_deep'
  | 'not_object'

export interface CreateMemberValidationErrorField {
  field: string
  code: CreateMemberValidationCode
}

export interface CreateMemberValidationErrorResponse {
  error: 'validation'
  fields: CreateMemberValidationErrorField[]
}

export interface SimpleErrorResponse {
  error:
    | 'unauthorized'
    | 'integration_inactive'
    | 'payload_too_large'
    | 'unsupported_media_type'
    | 'rate_limited'
    | 'queue_depth_exceeded'
    | 'queue_unavailable'
    | 'feature_disabled'
    | 'not_found'
    | 'result_expired'
}

// GET /api/integrations/{integrationId}/members/jobs/{jobId}

export interface MemberJobErrorWire {
  code: 'validation' | 'tenant_inactive' | 'integration_paused' | 'internal'
  message: string
}

export type MemberJobStatusResponse =
  | { status: 'queued' | 'processing'; submitted_at: string; attempts: number }
  | { status: 'succeeded'; member_id: string; outcome: 'created' | 'existing' }
  | { status: 'failed'; error: MemberJobErrorWire }

// Outbound event payloads (api_version pinned per event; <= 8 KB)

export const OUTBOUND_API_VERSION = '2026-09-01'

export type OutboundSourceWire = 'whatsapp' | 'web' | 'csv_import' | 'partner_api'

export interface OutboundConsentWire {
  effective_level: ConsentLevelWire
  utility: 'opted_in' | 'pending' | 'opted_out' | 'none'
  marketing: 'opted_in' | 'pending' | 'opted_out' | 'none'
  grade: 'strong' | 'weak' | 'medium' | 'none' | null
}

interface OutboundEventEnvelope<Type extends string, Data> {
  id: string
  type: Type
  occurred_at: string
  api_version: typeof OUTBOUND_API_VERSION
  restaurant_id: string
  integration_id: string
  origin_integration_id: string | null
  data: Data
}

export type MemberCreatedEvent = OutboundEventEnvelope<
  'member.created',
  {
    member_id: string
    phone_e164: string
    name: string | null
    language: LanguageWire
    source: OutboundSourceWire
    external_ref: string | null
    created_at: string
    consent: OutboundConsentWire
  }
>

export type MemberUpdatedEvent = OutboundEventEnvelope<
  'member.updated',
  {
    member_id: string
    phone_e164: string
    name: string | null
    language: LanguageWire
    source: OutboundSourceWire
    external_ref: string | null
    created_at: string
    consent: OutboundConsentWire
    changed: Array<'name' | 'language' | 'status' | 'consent' | 'external_ref'>
    status: 'active' | 'unsubscribed'
  }
>

export type PingEvent = OutboundEventEnvelope<'ping', Record<string, never>>

export type OutboundEventPayload = MemberCreatedEvent | MemberUpdatedEvent | PingEvent
