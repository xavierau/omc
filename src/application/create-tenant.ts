import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { findBySlug } from '@/infrastructure/supabase/repositories/restaurant-repository'
import {
  createRestaurant,
} from '@/infrastructure/supabase/repositories/restaurant-admin-repository'
import { createUserTenant } from '@/infrastructure/supabase/repositories/user-tenant-repository'

export interface CreateTenantInput {
  name: string
  slug: string
  whatsappNumber?: string
  kapsoPhoneNumberId?: string
  metaBusinessAccountId?: string
  adminEmail: string
  adminPassword: string
}

export interface CreateTenantResult {
  id: string
  slug: string
}

async function ensureSlugUnique(slug: string): Promise<void> {
  const existing = await findBySlug(slug)
  if (existing) {
    throw new TenantValidationError(`Slug "${slug}" is already taken`)
  }
}

async function createAdminUser(
  email: string,
  password: string
): Promise<string> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error) {
    throw new TenantValidationError(`Failed to create user: ${error.message}`)
  }
  return data.user.id
}

export async function createTenant(
  input: CreateTenantInput
): Promise<CreateTenantResult> {
  await ensureSlugUnique(input.slug)

  const restaurant = await createRestaurant({
    name: input.name,
    slug: input.slug,
    whatsapp_number: input.whatsappNumber,
    kapso_phone_number_id: input.kapsoPhoneNumberId ?? undefined,
    meta_business_account_id: input.metaBusinessAccountId,
  })

  const userId = await createAdminUser(input.adminEmail, input.adminPassword)
  await createUserTenant(userId, restaurant.id, 'admin')

  return { id: restaurant.id, slug: restaurant.slug }
}

export class TenantValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantValidationError'
  }
}
