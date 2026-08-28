import { NextResponse } from 'next/server'
import {
  CrossTenantMemberError,
  CampaignUniqueViolationError,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { CrossTenantTagError } from '@/application/set-campaign-tags'
import { CampaignBodyError } from './parse-create-body'

/**
 * True for the one unique violation the campaign routes answer with a 409.
 * Exported so PATCH can answer it with its own edit-flavoured copy before
 * delegating everything else to `handleError` (review round 2, finding 3).
 */
export function isWelcomeUniqueViolation(error: unknown): boolean {
  return (
    error instanceof CampaignUniqueViolationError &&
    error.constraint === 'idx_campaigns_one_active_welcome_per_restaurant'
  )
}

/**
 * Translate campaign failures into HTTP responses. Extracted from route.ts
 * (shared by GET/POST, and by the [id] PATCH handler) to keep those files
 * under the 150-line cap once tag targeting added its error branches.
 */
export function handleError(error: unknown, logLabel: string, defaultMsg: string) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }
  if (error instanceof CampaignBodyError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (error instanceof CrossTenantMemberError || error instanceof CrossTenantTagError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (isWelcomeUniqueViolation(error)) {
    return NextResponse.json(
      {
        error:
          'An active welcome campaign already exists for this restaurant. Edit it instead of creating a new one.',
      },
      { status: 409 }
    )
  }
  console.error(`${logLabel}:`, error)
  return NextResponse.json({ error: defaultMsg }, { status: 500 })
}
