// WONB-008 Stream C: server-side reconfirmation create flow.
// - Re-runs preflight (defence in depth — never trust the client).
// - Validates the supplied template is approved + UTILITY category.
// - Forces mode='reconfirmation' + status='active' so executeCampaign can
//   claim it via the existing transition path.
// - Note: WAQ-007 24h marketing cooldown is bypassed for UTILITY templates
//   inside Stream B's executeReconfirmationBatch (correct by design).

import { NextResponse } from 'next/server'
import { checkReconfirmationEligibility } from '@/application/check-reconfirmation-eligibility'
import { findTemplateById } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { createCampaign } from '@/infrastructure/supabase/repositories/campaign-repository'
import { logAdminAction, extractIp } from '@/infrastructure/supabase/audit-logger'
import type { TenantContext } from '@/infrastructure/supabase/guards/tenant-guard'

interface ReconfirmationCreateInput {
  body: Record<string, unknown>
  tenant: TenantContext
  request: Request
}

export async function handleReconfirmationCreate(
  input: ReconfirmationCreateInput
): Promise<NextResponse> {
  const validated = validateBody(input.body)
  if (validated instanceof NextResponse) return validated

  const eligibility = await checkReconfirmationEligibility({
    restaurantId: input.tenant.restaurantId,
  })
  if (!eligibility.allowed) {
    return NextResponse.json(
      {
        error: 'Reconfirmation not allowed',
        reason: 'reconfirmation_not_allowed',
        violations: eligibility.violations,
      },
      { status: 400 }
    )
  }

  const templateError = await assertUtilityTemplate(
    validated.templateId,
    input.tenant.restaurantId
  )
  if (templateError) return templateError

  const campaign = await createCampaign({
    restaurantId: input.tenant.restaurantId,
    name: validated.name,
    type: 'promo',
    legacyTemplate: '',
    whatsappTemplateId: validated.templateId,
    status: 'active',
    mode: 'reconfirmation',
    targetAudience: 'all',
  })

  // events.campaign is emitted at LAUNCH time inside
  // executeReconfirmationCampaign — that's the actual "campaign launched"
  // moment per AC #11. Audit trail for the create action lives in
  // logAdminAction below.
  logAdminAction({
    userId: input.tenant.userId,
    action: 'reconfirmation.create',
    resourceType: 'campaign',
    resourceId: campaign.id,
    details: {
      restaurantId: input.tenant.restaurantId,
      templateId: validated.templateId,
      audienceCount: eligibility.audienceCount,
    },
    ipAddress: extractIp(input.request),
  })

  return NextResponse.json({ campaignId: campaign.id }, { status: 201 })
}

interface ValidatedBody {
  name: string
  templateId: string
}

function validateBody(body: Record<string, unknown>): ValidatedBody | NextResponse {
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (typeof body.templateId !== 'string' || body.templateId.trim() === '') {
    return NextResponse.json(
      { error: 'templateId is required' },
      { status: 400 }
    )
  }
  return { name: body.name.trim(), templateId: body.templateId.trim() }
}

async function assertUtilityTemplate(
  templateId: string,
  restaurantId: string
): Promise<NextResponse | null> {
  const tpl = await findTemplateById(templateId)
  // P1 fix (review finding 4): findTemplateById is not tenant-scoped, so
  // without this check a tenant could attach another tenant's UTILITY
  // template to their reconfirmation campaign. Refuse here with a typed
  // reason so the dialog renders a specific i18n string.
  if (!tpl || tpl.restaurantId !== restaurantId) {
    return NextResponse.json(
      {
        error: 'Template not owned by tenant',
        reason: 'TEMPLATE_NOT_OWNED_BY_TENANT',
      },
      { status: 400 }
    )
  }
  if (tpl.status !== 'approved' || tpl.category !== 'UTILITY') {
    return NextResponse.json(
      {
        error: 'Reconfirmation template must be an approved UTILITY template',
        reason: 'template_not_utility',
      },
      { status: 400 }
    )
  }
  return null
}
