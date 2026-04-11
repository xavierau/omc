import { NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkCampaignGuardrails } from '@/application/check-campaign-guardrails'

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const guardrails = await checkCampaignGuardrails(restaurantId, 0)

    return NextResponse.json({
      allowed: guardrails.allowed,
      violations: guardrails.violations,
      warnings: guardrails.warnings,
      usage: {
        monthlySends: guardrails.usage.monthlySends,
        monthlyLimit: guardrails.usage.monthlyLimit,
        dailyCampaigns: guardrails.usage.dailyCampaigns,
        dailyLimit: guardrails.usage.dailyLimit,
        unsubscribeRate: guardrails.usage.unsubscribeRate,
        maxRate: guardrails.usage.maxUnsubscribeRate,
      },
    })
  } catch (error) {
    return handleError(error, 'Guardrails status error')
  }
}

function handleError(error: unknown, label: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error(`${label}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
