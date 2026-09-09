// INT-001 WI-6 US-7/US-9: "Send test event" -- a `ping` event through the
// IDENTICAL emit + fan-out + delivery path as every other event (T-M6: no
// bypass), against the integration's saved, validated URL only.
//
// Known limitation (flagged, not silently accepted): migration 071's
// fan-out trigger (frozen, WI-1) fans a `ping` out to EVERY
// `outbound_enabled` integration on the restaurant with a saved URL + PII
// ack, not just the one the owner clicked "test" on -- it has no per-
// integration scoping for `ping`, only a restaurant-wide one (by design,
// for `member.created`/`member.updated`, where that IS the right
// behaviour). A restaurant running two enabled integrations will see BOTH
// receive a ping when the owner tests either one. This function still
// returns the ONE delivery id for the target integration; the others (if
// any) are harmless -- `ping` carries no PII -- but are a real, disclosed
// UX surprise a migration change could fix, which is out of this work
// item's boundary.

import { randomUUID } from 'node:crypto'
import { findIntegrationSettingsById } from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { findDeliveriesByEventId } from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import { emitIntegrationEvent } from '@/application/emit-integration-event'
import type { IntegrationEvent } from '@/domain/entities/integration-event'

export type SendTestEventResult =
  | { ok: true; deliveryId: string }
  | { ok: false; error: 'integration_not_found' | 'url_not_saved' | 'not_eligible_for_delivery' }

export async function sendTestEvent(integrationId: string): Promise<SendTestEventResult> {
  const settings = await findIntegrationSettingsById(integrationId)
  if (!settings) return { ok: false, error: 'integration_not_found' }
  if (!settings.snapshot.outboundUrl) return { ok: false, error: 'url_not_saved' }

  const event: IntegrationEvent = {
    id: `evt_${randomUUID()}`,
    restaurantId: settings.snapshot.restaurantId,
    memberId: null,
    type: 'ping',
    changed: [],
    originIntegrationId: null,
    occurredAt: new Date().toISOString(),
    source: null,
  }

  await emitIntegrationEvent(event)

  const deliveries = await findDeliveriesByEventId(event.id)
  const mine = deliveries.find((d) => d.snapshot.integrationId === integrationId)
  if (!mine) {
    // The fan-out trigger requires outbound_enabled + a PII ack in
    // addition to the URL this function already checked -- if either is
    // missing, no row was created at all for this (or any) integration.
    return { ok: false, error: 'not_eligible_for_delivery' }
  }

  return { ok: true, deliveryId: mine.snapshot.id }
}
