export type TenantStatus = 'active' | 'inactive' | 'trial'

export interface Restaurant {
  id: string
  name: string
  slug: string
  whatsappNumber: string
  kapsoPhoneNumberId: string | null
  metaBusinessAccountId: string | null
  status: TenantStatus
  trialExpiresAt: string | null
  createdAt: string
}
