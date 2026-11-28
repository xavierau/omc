import type { Referrer } from '@/domain/entities/referrer'
import { createReferrer } from '@/infrastructure/supabase/repositories/referrer-repository'

export interface CreateReferrerInput {
  name: string
  contactEmail: string
  contactPhone?: string | null
  commissionPerMessageHkd?: number | null
  commissionPerRedemptionHkd?: number | null
}

export type CreateReferrerResult =
  | { success: true; referrer: Referrer }
  | { success: false; message: string }

export async function createReferrerUseCase(
  input: CreateReferrerInput
): Promise<CreateReferrerResult> {
  try {
    const referrer = await createReferrer(input)
    return { success: true, referrer }
  } catch (error) {
    console.error('createReferrer failed:', error)
    return { success: false, message: 'Failed to create referrer. Please try again.' }
  }
}
