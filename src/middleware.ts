import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (pathname.startsWith('/dashboard') && !user) {
    return redirectTo('/login', request)
  }

  if (pathname.startsWith('/dashboard') && user && !pathname.startsWith('/dashboard/blocked')) {
    const blocked = await isTenantBlocked(request, supabase, user.id)
    if (blocked) {
      return redirectTo('/dashboard/blocked', request)
    }
  }

  if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/login')) {
    if (!user) {
      return redirectTo('/admin/login', request)
    }
  }

  setSecurityHeaders(response)
  return response
}

async function isTenantBlocked(
  request: NextRequest,
  supabase: ReturnType<typeof createServerClient>,
  userId: string
): Promise<boolean> {
  const tenantId = request.cookies.get('x-tenant-id')?.value
  if (!tenantId) return false

  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('status, trial_expires_at')
    .eq('id', tenantId)
    .single()

  if (!restaurant) return false

  if (restaurant.status === 'inactive') return true
  if (restaurant.status === 'trial' && restaurant.trial_expires_at) {
    return new Date(restaurant.trial_expires_at) < new Date()
  }
  return false
}

function redirectTo(path: string, request: NextRequest) {
  const url = request.nextUrl.clone()
  url.pathname = path
  return NextResponse.redirect(url)
}

function setSecurityHeaders(response: NextResponse) {
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'],
}
