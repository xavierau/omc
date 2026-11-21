/**
 * BOOK-010 (threat R3, spec AC-11): who may read capacity and stop / resume
 * bookings: an admin or staff member of the session's tenant (the roles the
 * decide routes serve). The tenant comes only from the session; a user
 * without access to it is refused by the guard (403).
 */
import { NextResponse } from 'next/server'
import { getTenantContext, type TenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

const STAFF_ROLES = ['admin', 'staff']

export const NO_STORE = { 'Cache-Control': 'no-store' }

export async function staffContext(): Promise<TenantContext | NextResponse> {
  const ctx = await getTenantContext()
  return STAFF_ROLES.includes(ctx.role) ? ctx : NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE })
}

export function failure(error: unknown, what: string): NextResponse {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.statusCode, headers: NO_STORE })
  console.error(`[Bookings] ${what} failed:`, (error as Error).message)
  return NextResponse.json({ error: `Failed to ${what}` }, { status: 500, headers: NO_STORE })
}
