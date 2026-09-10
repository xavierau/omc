import { createServerSupabaseClient } from '../client'
import type { PosTransaction } from '@/domain/entities/pos-transaction'

/** Returns null on unique constraint violation (idempotency). */
export async function createPosTransaction(
  input: Omit<PosTransaction, 'id'>
): Promise<string | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('pos_transactions')
    .insert(toInsertRow(input))
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return null
    throw new Error(`createPosTransaction: ${error.message}`)
  }
  return data!.id
}

export async function findPosTransactionByExternalId(
  posIntegrationId: string,
  externalTransactionId: string
): Promise<PosTransaction | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('pos_transactions')
    .select('*')
    .eq('pos_integration_id', posIntegrationId)
    .eq('external_transaction_id', externalTransactionId)
    .single()

  if (error || !data) return null
  return mapRow(data)
}

export async function findPosTransactionsByRestaurant(
  restaurantId: string,
  options?: { limit?: number; offset?: number }
): Promise<PosTransaction[]> {
  const supabase = createServerSupabaseClient()
  const limit = options?.limit ?? 50
  let query = supabase
    .from('pos_transactions')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('processed_at', { ascending: false })

  if (options?.limit) query = query.limit(limit)
  if (options?.offset) query = query.range(options.offset, options.offset + limit - 1)

  const { data, error } = await query
  if (error) throw new Error(`findPosTransactionsByRestaurant: ${error.message}`)
  return (data ?? []).map(mapRow)
}

export async function updatePosTransactionMember(
  id: string,
  memberId: string,
  pointsAwarded: number
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('pos_transactions')
    .update({ member_id: memberId, points_awarded: pointsAwarded })
    .eq('id', id)

  if (error) throw new Error(`updatePosTransactionMember: ${error.message}`)
}

/** Atomically claims an unlinked transaction. Returns false if already claimed. */
export async function claimUnlinkedTransaction(
  transactionId: string,
  memberId: string,
  pointsAwarded: number
): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('pos_transactions')
    .update({ member_id: memberId, points_awarded: pointsAwarded })
    .eq('id', transactionId)
    .is('member_id', null)
    .select('id')
    .single()

  if (error || !data) return false
  return true
}

export async function findUnlinkedTransactionsByPhone(
  restaurantId: string,
  phone: string
): Promise<PosTransaction[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('pos_transactions')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('customer_phone', phone)
    .is('member_id', null)
    .order('processed_at', { ascending: true })

  if (error) throw new Error(`findUnlinkedTransactionsByPhone: ${error.message}`)
  return (data ?? []).map(mapRow)
}

function toInsertRow(input: Omit<PosTransaction, 'id'>) {
  return {
    pos_integration_id: input.posIntegrationId,
    restaurant_id: input.restaurantId,
    member_id: input.memberId,
    external_transaction_id: input.externalTransactionId,
    type: input.type,
    amount: input.amount,
    currency: input.currency,
    customer_phone: input.customerPhone,
    points_awarded: input.pointsAwarded,
    raw_payload: input.rawPayload,
    processed_at: input.processedAt,
  }
}

function mapRow(row: Record<string, unknown>): PosTransaction {
  return {
    id: row.id as string,
    posIntegrationId: row.pos_integration_id as string,
    restaurantId: row.restaurant_id as string,
    memberId: (row.member_id as string) ?? null,
    externalTransactionId: row.external_transaction_id as string,
    type: row.type as PosTransaction['type'],
    amount: Number(row.amount),
    currency: row.currency as string,
    customerPhone: (row.customer_phone as string) ?? null,
    pointsAwarded: row.points_awarded as number,
    rawPayload: (row.raw_payload as Record<string, unknown>) ?? {},
    processedAt: row.processed_at as string,
  }
}
