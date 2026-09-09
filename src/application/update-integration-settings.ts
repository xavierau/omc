// INT-001 WI-8: settings PATCH orchestration for `GET/PATCH
// /api/dashboard/pos-integrations/[id]/settings` (T-M5 new-route role gate
// is the ROUTE's job; this file owns the per-field business rules + the
// audit trail). Closes T-M11's "save-time template ownership check" half
// (WI-4 owns the SEND-time re-check -- deliberately a separate,
// independent implementation per T-M11's own text: "re-resolved and
// re-checked... at send time", not a shared call).
//
// Design: validate every present field into a resolved value FIRST (no
// writes yet); build the merged candidate state (current row + patch) and
// run it through `IntegrationSettings.fromProps()` -- WI-1's OWN frozen
// entity invariant ("outbound_enabled requires url + pii ack + secret") --
// rather than re-deriving that rule by hand. Only if everything validates
// do we perform ONE `updateIntegrationSettingsFields` write plus one audit
// row per changed field (who/when/old->new, spec's explicit requirement
// for both the template control (US-8) and the outbound card (US-7/US-9)).

import { IntegrationSettings, type IntegrationSettingsProps } from '@/domain/entities/integration-settings'
import { isTemplateSendable, type TemplateCategory } from '@/domain/entities/whatsapp-template'
import type { ParsedSettingsPatch } from '@/infrastructure/validation/integration-settings-validators'
import {
  findIntegrationSettingsById,
  updateIntegrationSettingsFields,
} from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { recordIntegrationSettingsAudit } from '@/infrastructure/supabase/repositories/integration-settings-audit-repository'
import {
  getOnboardingSettings,
} from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { getCampaignByIdForRestaurant } from '@/infrastructure/supabase/repositories/campaign-repository'
import {
  findByIdForRestaurant as findTemplateByIdForRestaurant,
  findById as findTemplateByIdUnscoped,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { isTenantAutoPaused } from '@/infrastructure/supabase/repositories/tenant-trust-queries'
import { validateOutboundUrl } from '@/application/validate-outbound-url'

export interface ResolvedTemplateView {
  name: string
  category: TemplateCategory
}

export interface IntegrationSettingsView {
  newJoinTemplateId: string | null
  resolvedTemplate: ResolvedTemplateView | null
  consentAttestationText: string | null
  consentAttestationAckAt: string | null
  outboundUrl: string | null
  outboundEvents: string[]
  outboundEnabled: boolean
  outboundPiiAckAt: string | null
  outboundStatus: IntegrationSettingsProps['outboundStatus']
  outboundFailureStreak: number
  outboundPausedAt: string | null
  outboundSecretLast4: string | null
  outboundSecretUpdatedAt: string | null
}

export type SettingsErrorCode =
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

export type UpdateSettingsResult =
  | { ok: true; settings: IntegrationSettingsView; warnings: string[] }
  | { ok: false; error: SettingsErrorCode }

export type GetSettingsResult = { ok: true; settings: IntegrationSettingsView } | { ok: false; error: 'not_found' }

function mapUrlError(error: { title: string; details: string }): SettingsErrorCode {
  if (error.details === 'https_required') return 'url_not_https'
  if (error.details === 'userinfo_not_allowed') return 'url_userinfo'
  if (error.details === 'port_443_only') return 'url_port'
  if (error.title === 'ssrf_rejected') return 'url_private_address'
  // not_a_valid_url, dns_error, no_addresses -- none of these have their
  // own code in the plan's frozen contract; url_invalid is the closest
  // honest fit (judgment call, flagged in the handoff artifact).
  return 'url_invalid'
}

type TemplateResolveResult =
  | { ok: true; templateId: string | null; resolvedTemplate: ResolvedTemplateView | null; tenantQualityPaused: boolean }
  | { ok: false; error: 'no_default_welcome_template' | 'template_not_found' | 'template_not_owned' | 'template_not_approved' }

/** Save-time counterpart of `process-member-create-job.ts`'s
 * `resolveWelcomeTemplate` -- an INDEPENDENT implementation by design
 * (T-M11), not a shared call, so a template rename/re-approval between
 * save and send is picked up fresh by each side. Unlike the send-time
 * resolver (which collapses every miss to one `skipped_no_template`
 * reason), this distinguishes the four codes the plan's frozen contract
 * names -- `template_not_owned` vs `template_not_found` needs an unscoped
 * existence check purely to tell the two apart; no template field beyond
 * "exists" is read from the unscoped row (template ids carry no PII).
 */
async function resolveNewJoinTemplate(
  newJoinTemplateId: string | null,
  restaurantId: string
): Promise<TemplateResolveResult> {
  if (newJoinTemplateId === null) {
    return { ok: true, templateId: null, resolvedTemplate: null, tenantQualityPaused: false }
  }

  if (newJoinTemplateId === 'default') {
    const onboarding = await getOnboardingSettings(restaurantId).catch(() => null)
    if (!onboarding?.welcomeCampaignId) return { ok: false, error: 'no_default_welcome_template' }
    const campaign = await getCampaignByIdForRestaurant(onboarding.welcomeCampaignId, restaurantId).catch(() => null)
    if (!campaign?.whatsappTemplateId) return { ok: false, error: 'no_default_welcome_template' }
    const template = await findTemplateByIdForRestaurant(campaign.whatsappTemplateId, restaurantId)
    if (!template || !isTemplateSendable(template)) return { ok: false, error: 'no_default_welcome_template' }
    const tenantQualityPaused = await isTenantAutoPaused(restaurantId)
    return {
      ok: true,
      templateId: 'default',
      resolvedTemplate: { name: template.name, category: template.category },
      tenantQualityPaused,
    }
  }

  const owned = await findTemplateByIdForRestaurant(newJoinTemplateId, restaurantId)
  if (owned) {
    if (!isTemplateSendable(owned)) return { ok: false, error: 'template_not_approved' }
    const tenantQualityPaused = await isTenantAutoPaused(restaurantId)
    return {
      ok: true,
      templateId: newJoinTemplateId,
      resolvedTemplate: { name: owned.name, category: owned.category },
      tenantQualityPaused,
    }
  }

  const existsAnywhere = await findTemplateByIdUnscoped(newJoinTemplateId)
  return { ok: false, error: existsAnywhere ? 'template_not_owned' : 'template_not_found' }
}

function toView(settings: IntegrationSettings, resolvedTemplate: ResolvedTemplateView | null): IntegrationSettingsView {
  const s = settings.snapshot
  return {
    newJoinTemplateId: s.newJoinTemplateId,
    resolvedTemplate,
    consentAttestationText: s.consentAttestationText,
    consentAttestationAckAt: s.consentAttestationAckAt,
    outboundUrl: s.outboundUrl,
    outboundEvents: s.outboundEvents,
    outboundEnabled: s.outboundEnabled,
    outboundPiiAckAt: s.outboundPiiAckAt,
    outboundStatus: s.outboundStatus,
    outboundFailureStreak: s.outboundFailureStreak,
    outboundPausedAt: s.outboundPausedAt,
    outboundSecretLast4: s.outboundSecretLast4,
    outboundSecretUpdatedAt: s.outboundSecretUpdatedAt,
  }
}

/** Re-resolves the CURRENT `newJoinTemplateId` (unchanged by this read) so
 * every GET/PATCH response carries a fresh `resolvedTemplate` -- a template
 * renamed or re-approved since it was set is reflected without the owner
 * having to re-save. Read-only: never returns an error code, since an
 * already-saved value that no longer resolves degrades to `null` rather
 * than breaking the read path. */
async function currentResolvedTemplate(
  newJoinTemplateId: string | null,
  restaurantId: string
): Promise<ResolvedTemplateView | null> {
  if (newJoinTemplateId === null) return null
  const resolved = await resolveNewJoinTemplate(newJoinTemplateId, restaurantId)
  return resolved.ok ? resolved.resolvedTemplate : null
}

export async function getIntegrationSettingsView(
  integrationId: string,
  restaurantId: string
): Promise<GetSettingsResult> {
  const settings = await findIntegrationSettingsById(integrationId)
  if (!settings) return { ok: false, error: 'not_found' }
  const resolvedTemplate = await currentResolvedTemplate(settings.snapshot.newJoinTemplateId, restaurantId)
  return { ok: true, settings: toView(settings, resolvedTemplate) }
}

export async function updateIntegrationSettings(
  integrationId: string,
  restaurantId: string,
  patch: ParsedSettingsPatch,
  actorUserId: string
): Promise<UpdateSettingsResult> {
  const current = await findIntegrationSettingsById(integrationId)
  if (!current) return { ok: false, error: 'template_not_found' } // unreachable: route 404s before calling this
  const c = current.snapshot

  const now = new Date().toISOString()
  const writeFields: Parameters<typeof updateIntegrationSettingsFields>[1] = {}
  const auditRows: Array<{ field: string; oldValue: string | null; newValue: string | null }> = []
  let resolvedTemplate: ResolvedTemplateView | null = null
  let tenantQualityPaused = false

  // -- newJoinTemplateId --
  let mergedNewJoinTemplateId = c.newJoinTemplateId
  if ('newJoinTemplateId' in patch) {
    const resolved = await resolveNewJoinTemplate(patch.newJoinTemplateId ?? null, restaurantId)
    if (!resolved.ok) return { ok: false, error: resolved.error }
    resolvedTemplate = resolved.resolvedTemplate
    tenantQualityPaused = resolved.tenantQualityPaused
    mergedNewJoinTemplateId = patch.newJoinTemplateId ?? null
    if (mergedNewJoinTemplateId !== c.newJoinTemplateId) {
      writeFields.newJoinTemplateId = mergedNewJoinTemplateId
      auditRows.push({ field: 'newJoinTemplateId', oldValue: c.newJoinTemplateId, newValue: mergedNewJoinTemplateId })
    }
  } else {
    resolvedTemplate = await currentResolvedTemplate(c.newJoinTemplateId, restaurantId)
  }

  // -- consentAttestationText --
  let mergedConsentText = c.consentAttestationText
  if ('consentAttestationText' in patch) {
    mergedConsentText = patch.consentAttestationText ?? null
    if (mergedConsentText !== c.consentAttestationText) {
      writeFields.consentAttestationText = mergedConsentText
      auditRows.push({ field: 'consentAttestationText', oldValue: c.consentAttestationText, newValue: mergedConsentText })
    }
  }

  // -- consentAttestationAck (boolean -> ack_at/ack_by pair) --
  let mergedConsentAckAt = c.consentAttestationAckAt
  if ('consentAttestationAck' in patch) {
    const nextAckAt = patch.consentAttestationAck ? now : null
    const nextAckBy = patch.consentAttestationAck ? actorUserId : null
    if (nextAckAt !== c.consentAttestationAckAt) {
      writeFields.consentAttestationAckAt = nextAckAt
      writeFields.consentAttestationAckBy = nextAckBy
      auditRows.push({ field: 'consentAttestationAck', oldValue: c.consentAttestationAckAt, newValue: nextAckAt })
    }
    mergedConsentAckAt = nextAckAt
  }

  // -- outboundUrl (T-C3/T-M6: same SSRF guard as the delivery attempt) --
  let mergedOutboundUrl = c.outboundUrl
  if ('outboundUrl' in patch && patch.outboundUrl !== undefined) {
    const urlCheck = await validateOutboundUrl(patch.outboundUrl)
    if (!urlCheck.ok) return { ok: false, error: mapUrlError(urlCheck.error) }
    mergedOutboundUrl = patch.outboundUrl
    if (mergedOutboundUrl !== c.outboundUrl) {
      writeFields.outboundUrl = mergedOutboundUrl
      auditRows.push({ field: 'outboundUrl', oldValue: c.outboundUrl, newValue: mergedOutboundUrl })
    }
  }

  // -- outboundEvents --
  let mergedOutboundEvents = c.outboundEvents
  if ('outboundEvents' in patch && patch.outboundEvents !== undefined) {
    mergedOutboundEvents = patch.outboundEvents
    if (JSON.stringify(mergedOutboundEvents) !== JSON.stringify(c.outboundEvents)) {
      writeFields.outboundEvents = mergedOutboundEvents
      auditRows.push({
        field: 'outboundEvents',
        oldValue: c.outboundEvents.join(','),
        newValue: mergedOutboundEvents.join(','),
      })
    }
  }

  // -- outboundPiiAck (boolean -> ack_at/ack_by pair) --
  let mergedPiiAckAt = c.outboundPiiAckAt
  if ('outboundPiiAck' in patch) {
    const nextAckAt = patch.outboundPiiAck ? now : null
    const nextAckBy = patch.outboundPiiAck ? actorUserId : null
    if (nextAckAt !== c.outboundPiiAckAt) {
      writeFields.outboundPiiAckAt = nextAckAt
      writeFields.outboundPiiAckBy = nextAckBy
      auditRows.push({ field: 'outboundPiiAck', oldValue: c.outboundPiiAckAt, newValue: nextAckAt })
    }
    mergedPiiAckAt = nextAckAt
  }

  // -- outboundEnabled -- validated LAST, against the merged state, via
  // WI-1's own frozen entity invariant (never re-derived by hand).
  let mergedOutboundEnabled = c.outboundEnabled
  if ('outboundEnabled' in patch && patch.outboundEnabled !== undefined) {
    mergedOutboundEnabled = patch.outboundEnabled
  }

  if (mergedOutboundEnabled !== c.outboundEnabled) {
    writeFields.outboundEnabled = mergedOutboundEnabled
    auditRows.push({
      field: 'outboundEnabled',
      oldValue: String(c.outboundEnabled),
      newValue: String(mergedOutboundEnabled),
    })
  }

  try {
    IntegrationSettings.fromProps({
      ...c,
      newJoinTemplateId: mergedNewJoinTemplateId,
      consentAttestationText: mergedConsentText,
      consentAttestationAckAt: mergedConsentAckAt,
      outboundUrl: mergedOutboundUrl,
      outboundEvents: mergedOutboundEvents,
      outboundEnabled: mergedOutboundEnabled,
      outboundPiiAckAt: mergedPiiAckAt,
    })
  } catch {
    return { ok: false, error: 'pii_ack_required' }
  }

  if (auditRows.length > 0) {
    await updateIntegrationSettingsFields(integrationId, writeFields)
    for (const row of auditRows) {
      await recordIntegrationSettingsAudit({
        integrationId,
        restaurantId,
        actorUserId,
        field: row.field,
        oldValue: row.oldValue,
        newValue: row.newValue,
      })
    }
  }

  const updated = await findIntegrationSettingsById(integrationId)
  if (!updated) return { ok: false, error: 'template_not_found' } // unreachable

  const warnings: string[] = []
  if (resolvedTemplate && tenantQualityPaused) warnings.push('tenant_quality_paused')

  return { ok: true, settings: toView(updated, resolvedTemplate), warnings }
}
