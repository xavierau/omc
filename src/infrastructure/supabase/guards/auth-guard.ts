import { cookies } from 'next/headers'
import { createAuthServerClient } from '../auth-client'

export interface AuthSession {
  userId: string
  email: string
}

export async function getAuthSession(): Promise<AuthSession> {
  const supabase = await createAuthServerClient(cookies())
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    throw new AuthError('Unauthorized', 401)
  }

  return { userId: user.id, email: user.email ?? '' }
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message)
    this.name = 'AuthError'
  }
}
