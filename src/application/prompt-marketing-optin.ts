import { randomUUID } from 'crypto'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import {
  findActiveConsent,
  insertConsentRecord,
} from '@/infrastructure/supabase/repositories/consent-record-repository'
import {
  findOptinTemplateOverride,
  findRecentPendingMarketingConsent,
} from '@/infrastructure/supabase/repositories/optin-template-repository'
import { findTemplateById } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { sendWhatsAppTemplateMessage } from '@/application/send-template-message'
import { enforceHeaderMedia } from '@/application/enforce-header-media'
import { ConsentRecord } from '@/domain/entities/consent-record'
import {
  shouldPromptOptin,
  type SkipReason,
} from '@/domain/services/should-prompt-optin'
import { ConsentImportError } from '@/domain/repositories/consent-record-repository'

export type PromptSkipReason =
  | SkipReason
  | 'template_unset'
  | 'template_missing'
  | 'template_not_utility'
  | 'race_lost'

export interface PromptMarketingOptinResult {
  promptSent: boolean
  reason?: PromptSkipReason
}

interface PromptInput {
  restaurantId: string
  phoneE164: string
  source: string
}

/**
 * WONB-007: orchestrates the inbound-first opt-in confirmation. Inserts a
 * `status=pending, grade=strong` consent row so the eventual YES upgrade is
 * a pure status flip via `upgradeToOptedIn`, then sends the configured
 * confirmation template.
 *
 * Idempotent on the consent insert: a duplicate-active error is treated as
 * a benign concurrent prompt and skips the send so the user doesn't get
 * two prompts.
 */
export async function promptMarketingOptin(
  input: PromptInput
): Promise<PromptMarketingOptinResult> {
  const gate = await evaluateGate(input)
  if (!gate.prompt) return { promptSent: false, reason: gate.reason }

  const templateId = await resolveTemplateId(input.restaurantId)
  if (!templateId) return { promptSent: false, reason: 'template_unset' }
  // Deliberately UNSCOPED lookup (unlike resolveWhatsAppTemplate, which the
  // #127 review scoped by tenant): the id comes from the platform env
  // fallback KAPSO_DEFAULT_OPTIN_TEMPLATE_ID — a cross-tenant template by
  // design — or from tenant_campaign_settings, which has no tenant-reachable
  // write path today. If a settings UI ever exposes the override, this must
  // become a scoped lookup with a platform-default fallback.
  const template = await findTemplateById(templateId)
  if (!template) return { promptSent: false, reason: 'template_missing' }
  // AC #8 spam-safety: a MARKETING-category template must NEVER be the
  // opt-in confirmation. Reject AUTHENTICATION too — only UTILITY is the
  // contract for this prompt. Misconfigured KAPSO_DEFAULT_OPTIN_TEMPLATE_ID
  // is the realistic failure mode this guards against.
  if (template.category !== 'UTILITY') {
    return { promptSent: false, reason: 'template_not_utility' }
  }
  // #127 review: gate BEFORE insertPending. The send-layer gate throws for a
  // media-header template with no usable URL; thrown after the insert, the
  // orphaned pending row would trip the 7-day re-prompt cooldown and starve
  // opt-ins with no signal. Throwing here reaches the callers' existing
  // never-throws logging with no consent row written.
  enforceHeaderMedia(template)

  const inserted = await insertPending(input, gate.memberId)
  if (!inserted) return { promptSent: false, reason: 'race_lost' }

  const phoneNumberId = await getRestaurantPhoneNumberId(input.restaurantId)
  await sendWhatsAppTemplateMessage({
    phoneNumberId,
    to: input.phoneE164,
    template,
    paramValues: {},
  })
  return { promptSent: true }
}

async function evaluateGate(input: PromptInput): Promise<
  | { prompt: true; memberId: string }
  | { prompt: false; reason: SkipReason }
> {
  const scope = {
    restaurantId: input.restaurantId,
    phoneE164: input.phoneE164,
  }
  const [member, active, pending] = await Promise.all([
    findMemberByPhone(input.restaurantId, input.phoneE164),
    findActiveConsent({ ...scope, category: 'marketing' }),
    findRecentPendingMarketingConsent(scope),
  ])
  const decision = shouldPromptOptin({
    existingMember: member ? { id: member.id } : null,
    activeMarketingConsent: active,
    recentPendingConsent: pending,
    isSystemKeyword: false,
  })
  if (!decision.prompt) {
    return { prompt: false, reason: decision.reason ?? 'no_member' }
  }
  return { prompt: true, memberId: (member as { id: string }).id }
}

async function resolveTemplateId(
  restaurantId: string
): Promise<string | null> {
  const override = await findOptinTemplateOverride(restaurantId)
  if (override) return override
  const fallback = process.env.KAPSO_DEFAULT_OPTIN_TEMPLATE_ID
  return fallback && fallback.trim() ? fallback : null
}

async function insertPending(
  input: PromptInput,
  memberId: string
): Promise<boolean> {
  try {
    await insertConsentRecord(
      ConsentRecord.markPending({
        id: randomUUID(),
        restaurantId: input.restaurantId,
        memberId,
        phoneE164: input.phoneE164,
        category: 'marketing',
        source: input.source,
      })
    )
    return true
  } catch (err) {
    if (
      err instanceof ConsentImportError &&
      err.reason === 'duplicate_active'
    ) {
      return false
    }
    throw err
  }
}
