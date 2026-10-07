import type { ReferrerCommission } from '@/domain/entities/referrer-commission'
import { markPaid } from '@/infrastructure/supabase/repositories/referrer-commission-repository'

export type MarkCommissionPaidResult =
  | { success: true; commission: ReferrerCommission }
  | { success: false; message: string }

export async function markCommissionPaidUseCase(
  id: string
): Promise<MarkCommissionPaidResult> {
  try {
    const commission = await markPaid(id)
    return { success: true, commission }
  } catch (error) {
    console.error('markCommissionPaid error:', error)
    return {
      success: false,
      message: 'Failed to mark commission as paid',
    }
  }
}
