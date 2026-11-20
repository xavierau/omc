import { cookies } from 'next/headers'
import { createAuthServerClient } from '../auth-client'
import { getAuthSession, AuthError } from './auth-guard'

export interface PlatformAdminSession {
  userId: string
}

export async function assertPlatformAdmin(): Promise<PlatformAdminSession> {
  const session = await getAuthSession()
  const supabase = await createAuthServerClient(cookies())

  const { data, error } = await supabase
    .from('platform_admins')
    .select('id')
    .eq('user_id', session.userId)
    .single()

  if (error || !data) {
    throw new AuthError('Forbidden: not a platform admin', 403)
  }

  return { userId: session.userId }
}
