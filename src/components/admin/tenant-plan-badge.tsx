import { Badge } from '@/components/ui/badge'
import type { TenantPlan } from '@/domain/value-objects/tenant-plan'

const PLAN_STYLES: Record<TenantPlan, string> = {
  starter: 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300',
  growth: 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900 dark:text-blue-300',
  pro: 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900 dark:text-purple-300',
}

const PLAN_LABELS: Record<TenantPlan, string> = {
  starter: 'Starter',
  growth: 'Growth',
  pro: 'Pro',
}

export function TenantPlanBadge({ plan }: { plan: TenantPlan }) {
  return (
    <Badge variant="outline" className={PLAN_STYLES[plan]}>
      {PLAN_LABELS[plan]}
    </Badge>
  )
}
