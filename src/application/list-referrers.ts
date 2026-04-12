import type { Referrer } from '@/domain/entities/referrer'
import {
  listReferrers,
  listActiveReferrers,
} from '@/infrastructure/supabase/repositories/referrer-repository'

export async function listReferrersUseCase(
  params: { status?: string } = {}
): Promise<Referrer[]> {
  if (params.status === 'active') return listActiveReferrers()
  if (params.status === 'inactive') {
    const all = await listReferrers()
    return all.filter((r) => r.status === 'inactive')
  }
  return listReferrers()
}
