import type { Referrer, ReferrerStatus } from '@/domain/entities/referrer'
import {
  findReferrerById,
  updateReferrer,
} from '@/infrastructure/supabase/repositories/referrer-repository'

export interface UpdateReferrerInput {
  id: string
  name?: string
  contactEmail?: string
  contactPhone?: string
  commissionPerMessageHkd?: number
  status?: ReferrerStatus
}

export type UpdateReferrerResult =
  | { success: true; referrer: Referrer }
  | { success: false; message: string }

export async function updateReferrerUseCase(
  input: UpdateReferrerInput
): Promise<UpdateReferrerResult> {
  const existing = await findReferrerById(input.id)
  if (!existing) return { success: false, message: 'Referrer not found.' }

  const { id, ...changes } = input
  const referrer = await updateReferrer(id, changes)
  return { success: true, referrer }
}
