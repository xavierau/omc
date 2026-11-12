import type { TenantPlan } from '@/domain/value-objects/tenant-plan'

export type TenantStatus = 'active' | 'inactive' | 'trial'

export interface Restaurant {
  id: string
  name: string
  slug: string
  whatsappNumber: string
  kapsoPhoneNumberId: string | null
  metaBusinessAccountId: string | null
  status: TenantStatus
  plan: TenantPlan
  trialExpiresAt: string | null
  referrerId: string | null
  createdAt: string
}
