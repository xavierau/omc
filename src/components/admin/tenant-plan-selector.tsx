'use client'

import { useUpdateTenantPlan } from '@/hooks/use-update-tenant-plan'
import type { TenantPlan } from '@/domain/value-objects/tenant-plan'
import { isValidPlan } from '@/domain/value-objects/tenant-plan'

const PLAN_OPTIONS: { value: TenantPlan; label: string }[] = [
  { value: 'starter', label: 'Starter' },
  { value: 'growth', label: 'Growth' },
  { value: 'pro', label: 'Pro' },
]

interface TenantPlanSelectorProps {
  tenantId: string
  currentPlan: TenantPlan
  onPlanChanged: () => void
}

export function TenantPlanSelector({ tenantId, currentPlan, onPlanChanged }: TenantPlanSelectorProps) {
  const { updatePlan, saving, error } = useUpdateTenantPlan(tenantId)

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    if (!isValidPlan(value)) return
    if (value === currentPlan) return
    const result = await updatePlan(value)
    if (result) onPlanChanged()
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="plan-select" className="text-sm font-medium text-muted-foreground">
        Plan:
      </label>
      <select
        id="plan-select"
        value={currentPlan}
        onChange={handleChange}
        disabled={saving}
        className="rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
      >
        {PLAN_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {saving && <span className="text-xs text-muted-foreground">Saving...</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
