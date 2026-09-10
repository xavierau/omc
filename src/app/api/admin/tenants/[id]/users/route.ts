import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  listByRestaurantId,
  createUserTenant,
  existsUserTenant,
} from '@/infrastructure/supabase/repositories/user-tenant-repository'
import { logAdminAction, extractIp } from '@/infrastructure/supabase/audit-logger'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { validateAddUser, ValidationError } from '@/infrastructure/validation/tenant-validators'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id } = await params
    const userTenants = await listByRestaurantId(id)
    const users = await resolveEmails(userTenants)
    return NextResponse.json(users)
  } catch (error) {
    return handleError(error, 'Tenant users list error')
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id } = await params
    const body = await request.json()
    validateAddUser(body)
    const { email, password, role } = body

    const newUserId = await findOrCreateUser(email, password)

    if (await existsUserTenant(newUserId, id)) {
      return NextResponse.json(
        { error: 'User already belongs to this tenant' },
        { status: 409 }
      )
    }

    await createUserTenant(newUserId, id, role ?? 'admin')

    logAdminAction({
      userId,
      action: 'user.add',
      resourceType: 'user',
      resourceId: newUserId,
      details: { tenantId: id, email, role: role ?? 'admin' },
      ipAddress: extractIp(request),
    })

    return NextResponse.json(
      { userId: newUserId, email, role: role ?? 'admin' },
      { status: 201 }
    )
  } catch (error) {
    return handleError(error, 'Add tenant user error')
  }
}

async function resolveEmails(
  userTenants: { user_id: string; role: string; created_at: string }[]
) {
  const supabase = createServerSupabaseClient()
  return Promise.all(
    userTenants.map(async (ut) => {
      const { data } = await supabase.auth.admin.getUserById(ut.user_id)
      return {
        userId: ut.user_id,
        email: data?.user?.email ?? '',
        role: ut.role,
        createdAt: ut.created_at,
      }
    })
  )
}

async function findOrCreateUser(
  email: string,
  password: string
): Promise<string> {
  const supabase = createServerSupabaseClient()
  const { data: listData } = await supabase.auth.admin.listUsers()
  const existing = listData?.users?.find((u) => u.email === email)
  if (existing) return existing.id

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw new Error(`Failed to create user: ${error.message}`)
  return data.user.id
}

function handleError(error: unknown, label: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  console.error(`${label}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
