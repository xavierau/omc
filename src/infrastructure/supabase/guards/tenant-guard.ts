import { cookies } from 'next/headers'
import { createAuthServerClient } from '../auth-client'
import { createServerSupabaseClient } from '../client'
import { getAuthSession, AuthError } from './auth-guard'
import { isTenantAccessible } from '@/domain/services/trial-status'
import type { TenantStatus } from '@/domain/entities/restaurant'

export interface TenantContext {
  userId: string
  restaurantId: string
  role: string
  tenantStatus: TenantStatus
}

export async function getTenantContext(): Promise<TenantContext> {
  const session = await getAuthSession()
  const cookieStore = await cookies()
  const tenantId = cookieStore.get('x-tenant-id')?.value

  if (!tenantId) {
    throw new AuthError('No tenant selected', 403)
  }

  const supabase = await createAuthServerClient(cookies())
  const { data, error } = await supabase
    .from('user_tenants')
    .select('restaurant_id, role')
    .eq('user_id', session.userId)
    .eq('restaurant_id', tenantId)
    .single()

  if (error || !data) {
    throw new AuthError('Forbidden: no access to tenant', 403)
  }

  const status = await fetchTenantStatus(data.restaurant_id)
  assertTenantActive(status)

  return {
    userId: session.userId,
    restaurantId: data.restaurant_id,
    role: data.role,
    tenantStatus: status.status,
  }
}

interface TenantStatusRow {
  status: TenantStatus
  trial_expires_at: string | null
}

async function fetchTenantStatus(
  restaurantId: string
): Promise<TenantStatusRow> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select('status, trial_expires_at')
    .eq('id', restaurantId)
    .single()

  if (error || !data) {
    throw new AuthError('Tenant not found', 404)
  }
  return data as TenantStatusRow
}

function assertTenantActive(row: TenantStatusRow): void {
  const accessible = isTenantAccessible({
    id: '',
    name: '',
    slug: '',
    whatsappNumber: '',
    kapsoPhoneNumberId: null,
    metaBusinessAccountId: null,
    status: row.status,
    trialExpiresAt: row.trial_expires_at,
    createdAt: '',
  })

  if (!accessible) {
    throw new AuthError('Tenant is inactive or trial expired', 403)
  }
}
