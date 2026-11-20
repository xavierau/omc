// INT-001 WI-6 T-H7: materialises the outbound wire payload from Postgres
// at ATTEMPT time, never from the job (the job carries `{deliveryId}`
// alone). Called by `deliver-outbound-webhook.ts` on every attempt, so a
// rename/consent-change/status-change between enqueue and delivery is
// always reflected in what actually goes out.

import { findMemberForOutboundPayload } from '@/infrastructure/supabase/repositories/integration-outbound-member-repository'
import { findLatestConsentByCategory } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { findExternalRefForMember } from '@/infrastructure/supabase/repositories/integration-member-ref-repository'
import { findEarliestMemberCreatedSource } from '@/infrastructure/supabase/repositories/integration-event-repository'
import { effectiveLevel } from '@/domain/value-objects/consent-level'
import type { IntegrationEvent } from '@/domain/entities/integration-event'
import {
  OUTBOUND_API_VERSION,
  type LanguageWire,
  type MemberCreatedEvent,
  type MemberUpdatedEvent,
  type OutboundConsentWire,
  type OutboundEventPayload,
  type OutboundSourceWire,
  type PingEvent,
} from '@/application/dtos/integration-member-api'

export type BuildOutboundPayloadResult =
  | { ok: true; payload: OutboundEventPayload; body: string }
  | { ok: false; error: { title: string; details: string } }

// `OutboundSourceWire` is a closed 4-value enum; `CreateOrGetMemberInput
// .source` is NOT -- it's a free-form string shared with other call sites
// (e.g. consent_records' own `source` column uses values like
// `whatsapp_join_keyword`). Every value this function actually reads
// (event.source, or the member's own member.created event's source) is
// validated against the enum before use; a value outside it -- including
// simply "unknown, because this member predates the outbox" -- falls back
// to `whatsapp`, this project's dominant historical join path (F1). This
// is a genuine judgment call with no ground truth to check it against;
// flagged in the WI-6 implementation note for product/architecture
// sign-off, exactly like the plan's own R1/R3/R4/R7.
const UNKNOWN_SOURCE_FALLBACK: OutboundSourceWire = 'whatsapp'

const OUTBOUND_SOURCES = new Set<string>(['whatsapp', 'web', 'csv_import', 'partner_api'])

function isOutboundSourceWire(value: string): value is OutboundSourceWire {
  return OUTBOUND_SOURCES.has(value)
}

function toLanguageWire(code: string | null): LanguageWire {
  return code === 'zh_hk' ? 'zh-HK' : 'en'
}

/**
 * `member.updated` events are produced entirely by DB triggers (migration
 * 071), which have no notion of "how did this member originally join" --
 * `event.source` is only ever set by the seam's `member.created` fast path.
 * Falls back to that same member's own `member.created` event when this
 * event didn't carry one; falls back again to `UNKNOWN_SOURCE_FALLBACK`
 * when neither exists (a member created before this feature shipped).
 */
async function resolveSource(event: IntegrationEvent, memberId: string): Promise<OutboundSourceWire> {
  if (event.source && isOutboundSourceWire(event.source)) return event.source
  const earliest = await findEarliestMemberCreatedSource(memberId)
  if (earliest && isOutboundSourceWire(earliest)) return earliest
  return UNKNOWN_SOURCE_FALLBACK
}

function buildConsent(
  utilityGrade: { status: string; grade: string } | null,
  marketingGrade: { status: string; grade: string } | null
): OutboundConsentWire {
  return {
    effective_level: effectiveLevel(
      (utilityGrade?.status as 'opted_in' | 'opted_out' | 'pending' | undefined) ?? null,
      (marketingGrade?.status as 'opted_in' | 'opted_out' | 'pending' | undefined) ?? null
    ),
    utility: (utilityGrade?.status as OutboundConsentWire['utility']) ?? 'none',
    marketing: (marketingGrade?.status as OutboundConsentWire['marketing']) ?? 'none',
    // Marketing's grade wins when both categories have a row -- OD-13
    // assigns grade uniformly per partner API call, so the two normally
    // agree; marketing is the more consequential permission when they
    // don't. Flagged as a judgment call (the wire type has one `grade`
    // field for two source rows).
    grade: (marketingGrade?.grade as OutboundConsentWire['grade'] | undefined) ??
      (utilityGrade?.grade as OutboundConsentWire['grade'] | undefined) ??
      null,
  }
}

function pingPayload(event: IntegrationEvent, restaurantId: string, integrationId: string): PingEvent {
  return {
    id: event.id,
    type: 'ping',
    occurred_at: event.occurredAt,
    api_version: OUTBOUND_API_VERSION,
    restaurant_id: restaurantId,
    integration_id: integrationId,
    origin_integration_id: event.originIntegrationId,
    data: {},
  }
}

export async function buildOutboundPayload(
  event: IntegrationEvent,
  restaurantId: string,
  integrationId: string
): Promise<BuildOutboundPayloadResult> {
  if (event.type === 'ping') {
    const payload = pingPayload(event, restaurantId, integrationId)
    return { ok: true, payload, body: JSON.stringify(payload) }
  }

  if (!event.memberId) {
    return { ok: false, error: { title: 'invalid_payload', details: 'member_id_required' } }
  }

  const member = await findMemberForOutboundPayload(event.memberId)
  if (!member) {
    return { ok: false, error: { title: 'member_not_found', details: event.memberId } }
  }

  const [utility, marketing, externalRef, source] = await Promise.all([
    findLatestConsentByCategory({ restaurantId, phoneE164: member.phone, category: 'utility' }),
    findLatestConsentByCategory({ restaurantId, phoneE164: member.phone, category: 'marketing' }),
    findExternalRefForMember({ memberId: member.id, integrationId }),
    resolveSource(event, member.id),
  ])

  const data = {
    member_id: member.id,
    phone_e164: member.phone,
    name: member.name,
    language: toLanguageWire(member.preferredLanguage),
    source,
    external_ref: externalRef,
    created_at: member.joinedAt,
    consent: buildConsent(
      utility ? { status: utility.snapshot.status, grade: utility.snapshot.consentGrade } : null,
      marketing ? { status: marketing.snapshot.status, grade: marketing.snapshot.consentGrade } : null
    ),
  }

  const envelope: {
    id: string
    occurred_at: string
    api_version: typeof OUTBOUND_API_VERSION
    restaurant_id: string
    integration_id: string
    origin_integration_id: string | null
  } = {
    id: event.id,
    occurred_at: event.occurredAt,
    api_version: OUTBOUND_API_VERSION,
    restaurant_id: restaurantId,
    integration_id: integrationId,
    origin_integration_id: event.originIntegrationId,
  }

  const payload: MemberCreatedEvent | MemberUpdatedEvent =
    event.type === 'member.created'
      ? { ...envelope, type: 'member.created', data }
      : {
          ...envelope,
          type: 'member.updated',
          data: {
            ...data,
            changed: event.changed as MemberUpdatedEvent['data']['changed'],
            status: member.status,
          },
        }

  return { ok: true, payload, body: JSON.stringify(payload) }
}
