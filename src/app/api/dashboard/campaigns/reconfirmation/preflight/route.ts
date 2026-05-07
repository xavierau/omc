// WONB-008 Stream C: pre-flight gate for the reconfirmation dialog.
// Tenant-manager auth via getTenantContext(). Composes Stream B's eligibility
// check with a UTILITY template preview + a 5-row audience sample (phone +
// capturedAt only — NO names/member ids). The dialog's create flow re-runs
// eligibility server-side, so this endpoint is purely informational.

import { NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkReconfirmationEligibility } from '@/application/check-reconfirmation-eligibility'
import { findReconfirmationAudienceSample } from '@/infrastructure/supabase/repositories/reconfirmation-audience-sample'
import { list as listTemplates } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

const SAMPLE_LIMIT = 5

interface TemplatePreview {
  id: string
  name: string
  bodyEn?: string
  bodyZhHk?: string
}

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const eligibility = await checkReconfirmationEligibility({ restaurantId })
    const [templatePreview, audienceSample] = await Promise.all([
      resolveTemplatePreview(restaurantId),
      resolveAudienceSample(restaurantId),
    ])
    return NextResponse.json({
      ...eligibility,
      templatePreview,
      audienceSample,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Reconfirmation preflight error:', error)
    return NextResponse.json({ error: 'Failed to load preflight' }, { status: 500 })
  }
}

async function resolveTemplatePreview(
  restaurantId: string
): Promise<TemplatePreview | undefined> {
  const result = await listTemplates({
    restaurantId,
    page: 1,
    pageSize: 1,
    status: 'approved',
    category: 'UTILITY',
  })
  const tpl = result.templates[0]
  if (!tpl) return undefined
  return projectTemplate(tpl)
}

function projectTemplate(tpl: WhatsAppTemplate): TemplatePreview {
  const body = tpl.components.find((c) => c.type === 'BODY')?.text
  const preview: TemplatePreview = { id: tpl.id, name: tpl.name }
  if (tpl.language === 'en' && body) preview.bodyEn = body
  if (tpl.language === 'zh_hk' && body) preview.bodyZhHk = body
  return preview
}

async function resolveAudienceSample(
  restaurantId: string
): Promise<Array<{ phoneE164: string; capturedAt: string }> | undefined> {
  const rows = await findReconfirmationAudienceSample({
    restaurantId,
    limit: SAMPLE_LIMIT,
  })
  return rows.length > 0 ? rows : undefined
}
