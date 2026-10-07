'use client'

import { useCampaignUsage } from '@/hooks/use-campaign-usage'
import { planCampaignQuota } from '@/domain/value-objects/tenant-plan'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { TenantPlan } from '@/domain/value-objects/tenant-plan'

function usageColor(ratio: number): string {
  if (ratio >= 0.9) return 'bg-red-500'
  if (ratio >= 0.7) return 'bg-yellow-500'
  return 'bg-green-500'
}

function usageTextColor(ratio: number): string {
  if (ratio >= 0.9) return 'text-red-600'
  if (ratio >= 0.7) return 'text-yellow-600'
  return 'text-green-600'
}

interface CampaignQuotaUsageProps {
  tenantId: string
  plan: TenantPlan
}

export function CampaignQuotaUsage({ tenantId, plan }: CampaignQuotaUsageProps) {
  const { data, loading, error } = useCampaignUsage(tenantId)
  const quota = planCampaignQuota(plan)
  const used = data?.totalSent ?? 0
  const ratio = quota > 0 ? Math.min(used / quota, 1) : 0

  if (loading) return <p className="text-sm text-muted-foreground">Loading usage...</p>
  if (error) return <p className="text-sm text-red-600">{error}</p>

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Campaign Quota</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className={usageTextColor(ratio)}>
            <strong>{used.toLocaleString()}</strong> / {quota.toLocaleString()} campaign messages used
          </span>
          <span className="text-muted-foreground text-xs">
            {(ratio * 100).toFixed(0)}%
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${usageColor(ratio)}`}
            style={{ width: `${ratio * 100}%` }}
            role="progressbar"
            aria-valuenow={used}
            aria-valuemin={0}
            aria-valuemax={quota}
          />
        </div>
      </CardContent>
    </Card>
  )
}
