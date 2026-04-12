import type { Referrer } from '@/domain/entities/referrer'
import type { ReferrerCommission } from '@/domain/entities/referrer-commission'
import { findReferrerById } from '@/infrastructure/supabase/repositories/referrer-repository'
import {
  getReferrerEarnings,
  listByReferrer,
} from '@/infrastructure/supabase/repositories/referrer-commission-repository'

export interface ReferrerDetail {
  referrer: Referrer
  earnings: { total: number; pending: number }
  recentCommissions: ReferrerCommission[]
}

export async function getReferrerDetailUseCase(
  id: string
): Promise<ReferrerDetail | null> {
  const referrer = await findReferrerById(id)
  if (!referrer) return null

  const [earnings, recentCommissions] = await Promise.all([
    getReferrerEarnings(id),
    listByReferrer(id),
  ])

  return { referrer, earnings, recentCommissions }
}
