import type { Referrer } from '@/domain/entities/referrer'
import {
  listReferrers,
  listActiveReferrers,
} from '@/infrastructure/supabase/repositories/referrer-repository'
import {
  listEarningsByReferrer,
  type ReferrerEarnings,
} from '@/infrastructure/supabase/repositories/referrer-commission-repository'

export interface ReferrerWithEarnings extends Referrer {
  earnings: ReferrerEarnings
}

export async function listReferrersUseCase(
  params: { status?: string } = {}
): Promise<ReferrerWithEarnings[]> {
  const referrers = await fetchReferrers(params.status)
  const earningsMap = await listEarningsByReferrer(referrers.map((r) => r.id))
  return referrers.map((r) => ({ ...r, earnings: earningsFor(earningsMap, r.id) }))
}

async function fetchReferrers(status?: string): Promise<Referrer[]> {
  if (status === 'active') return listActiveReferrers()
  if (status === 'inactive') {
    const all = await listReferrers()
    return all.filter((r) => r.status === 'inactive')
  }
  return listReferrers()
}

function earningsFor(
  map: Map<string, ReferrerEarnings>,
  id: string
): ReferrerEarnings {
  return (
    map.get(id) ?? {
      total: 0,
      pending: 0,
      totalBroadcast: 0,
      totalRedemption: 0,
    }
  )
}
