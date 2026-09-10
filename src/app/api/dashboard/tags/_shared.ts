// TAG-001 — Stream B: shared HTTP error mapping for the tag routes. Mirrors the
// imports _shared pattern: AuthError → its own status; TagValidationError → 400;
// TagNameConflictError → 409; TagNotFoundError → 404; anything else → 500 with a
// generic message (no internals leaked).

import { NextResponse } from 'next/server'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { TagValidationError } from '@/domain/services/__errors__/tag-errors'
import {
  TagNameConflictError,
  TagNotFoundError,
} from '@/infrastructure/supabase/repositories/tag-repository'

export function mapTagRouteError(
  error: unknown,
  logLabel: string
): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }
  if (error instanceof TagValidationError) {
    return NextResponse.json(
      { error: error.message, reason: error.reason },
      { status: 400 }
    )
  }
  if (error instanceof TagNameConflictError) {
    return NextResponse.json(
      { error: 'Tag name already exists', code: 'duplicate_name' },
      { status: 409 }
    )
  }
  if (error instanceof TagNotFoundError) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
  }
  console.error(`${logLabel}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
