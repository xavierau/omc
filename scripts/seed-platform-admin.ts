import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

interface AdminCredentials {
  email: string
  password: string
}

function readCredentials(): AdminCredentials {
  const email = process.env.PLATFORM_ADMIN_EMAIL
  const password = process.env.PLATFORM_ADMIN_PASSWORD
  if (!email || !password) {
    console.error(
      'ERROR: PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD must be set.',
    )
    process.exit(1)
  }
  return { email, password }
}

function buildAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error(
      'ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.',
    )
    process.exit(1)
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

async function findUserByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<User | null> {
  const target = email.toLowerCase()
  let page = 1
  const perPage = 200
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    const match = data.users.find((u) => u.email?.toLowerCase() === target)
    if (match) return match
    if (data.users.length < perPage) return null
    page += 1
  }
}

async function ensureUser(
  supabase: SupabaseClient,
  creds: AdminCredentials,
): Promise<{ userId: string; created: boolean }> {
  const existing = await findUserByEmail(supabase, creds.email)
  if (existing) return { userId: existing.id, created: false }

  const { data, error } = await supabase.auth.admin.createUser({
    email: creds.email,
    password: creds.password,
    email_confirm: true,
  })
  if (error || !data.user) {
    throw new Error(`createUser failed: ${error?.message ?? 'unknown error'}`)
  }
  return { userId: data.user.id, created: true }
}

async function isAlreadyPlatformAdmin(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('platform_admins')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`platform_admins lookup failed: ${error.message}`)
  return data !== null
}

async function promoteToPlatformAdmin(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('platform_admins')
    .insert({ user_id: userId })
  if (error) throw new Error(`platform_admins insert failed: ${error.message}`)
}

async function seed(): Promise<void> {
  const creds = readCredentials()
  const supabase = buildAdminClient()
  const { userId, created } = await ensureUser(supabase, creds)
  const alreadyAdmin = await isAlreadyPlatformAdmin(supabase, userId)

  if (alreadyAdmin) {
    console.log(`Admin ${creds.email} already exists (user_id=${userId})`)
    return
  }

  await promoteToPlatformAdmin(supabase, userId)
  if (created) {
    console.log(`Created admin ${creds.email} (user_id=${userId})`)
  } else {
    console.log(`Promoted existing user ${creds.email} to platform admin (user_id=${userId})`)
  }
}

seed().catch((err) => {
  console.error('seed-platform-admin failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
