'use client'

import { useState, useCallback } from 'react'
import type { TenantPlan } from '@/domain/value-objects/tenant-plan'

interface UpdatePlanResult {
  plan: TenantPlan
  campaignQuota: number
}

export function useUpdateTenantPlan(tenantId: string) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updatePlan = useCallback(
    async (plan: TenantPlan): Promise<UpdatePlanResult | null> => {
      setSaving(true)
      setError(null)
      try {
        const res = await fetch(`/api/admin/tenants/${tenantId}/plan`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan }),
        })
        if (!res.ok) throw new Error('Failed to update plan')
        return (await res.json()) as UpdatePlanResult
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Update failed'
        setError(msg)
        return null
      } finally {
        setSaving(false)
      }
    },
    [tenantId]
  )

  return { updatePlan, saving, error }
}
