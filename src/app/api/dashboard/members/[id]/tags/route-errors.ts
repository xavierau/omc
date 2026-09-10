// TAG-001: shared HTTP translation for the member-tags routes. Cross-tenant
// tag/member errors surface as their own status (403/400); anything else is a
// generic 500 with the detail logged server-side (never leaked to the client).

import { NextResponse } from 'next/server'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { CrossTenantTagError } from '@/infrastructure/supabase/repositories/member-tag-repository'
import { CrossTenantMemberError } from '@/infrastructure/supabase/repositories/campaign-members-repository'

export function translateMemberTagError(error: unknown): NextResponse {
  if (error instanceof AuthError) return errorJson(error.message, error.statusCode)
  if (error instanceof CrossTenantTagError) return errorJson(error.message, error.statusCode)
  if (error instanceof CrossTenantMemberError) return errorJson(error.message, error.statusCode)
  console.error('Member tags API error:', error)
  return errorJson('Failed to process member tags', 500)
}

function errorJson(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status })
}
