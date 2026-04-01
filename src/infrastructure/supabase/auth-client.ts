import { createBrowserClient } from '@supabase/ssr'
import { createServerClient as createSSRServerClient } from '@supabase/ssr'
import type { cookies } from 'next/headers'

export function createAuthBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function createAuthServerClient(
  cookieStore: ReturnType<typeof cookies>
) {
  const store = await cookieStore
  return createSSRServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return store.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options)
          }
        },
      },
    }
  )
}
