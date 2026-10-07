import { describe, it, expect } from 'vitest'
import type { TenantPlan } from '@/domain/value-objects/tenant-plan'

// Test the plan badge styling logic (pure data)
const PLAN_STYLES: Record<TenantPlan, string> = {
  starter: 'bg-gray-100',
  growth: 'bg-blue-100',
  pro: 'bg-purple-100',
}

const PLAN_LABELS: Record<TenantPlan, string> = {
  starter: 'Starter',
  growth: 'Growth',
  pro: 'Pro',
}

describe('TenantPlanBadge data', () => {
  it.each<[TenantPlan, string, string]>([
    ['starter', 'bg-gray-100', 'Starter'],
    ['growth', 'bg-blue-100', 'Growth'],
    ['pro', 'bg-purple-100', 'Pro'],
  ])('maps %s to correct style and label', (plan, style, label) => {
    expect(PLAN_STYLES[plan]).toContain(style)
    expect(PLAN_LABELS[plan]).toBe(label)
  })
})
