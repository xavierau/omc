// Error → HTTP mapping for the owner stamp-campaign CRUD route. Kept beside the route
// so the handlers stay thin and the file-size limit holds. Each typed application
// error becomes a friendly status + body (plan §9).
import { NextResponse } from 'next/server'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import {
  NoRewardsError,
  RewardNotFoundError,
  CapBlockedError,
} from '@/application/create-stamp-campaign-use-case'
import {
  OneActiveCampaignError,
  StampCampaignNotFoundError,
} from '@/application/transition-stamp-campaign-use-case'

export function mapStampCampaignError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return json(error.message, error.statusCode)
  }
  if (error instanceof NoRewardsError) return json(error.message, 409)
  if (error instanceof RewardNotFoundError) return json(error.message, 400)
  if (error instanceof CapBlockedError) return json(error.message, 422)
  if (error instanceof OneActiveCampaignError) return json(error.message, 409)
  if (error instanceof StampCampaignNotFoundError) return json(error.message, 404)
  console.error('[campaigns/stamps] error:', error)
  return json('server_error', 500)
}

function json(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status })
}
