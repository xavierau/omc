import { createServerSupabaseClient } from '../client'
import type { PosIntegration } from '@/domain/entities/pos-integration'

export async function findPosIntegrationById(
  id: string
): Promise<PosIntegration | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('pos_integrations')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return null
  return mapRow(data)
}

export async function findPosIntegrationsByRestaurant(
  restaurantId: string
): Promise<PosIntegration[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('pos_integrations')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`findPosIntegrationsByRestaurant: ${error.message}`)
  return (data ?? []).map(mapRow)
}

export async function createPosIntegration(
  input: Omit<PosIntegration, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('pos_integrations')
    .insert(toInsertRow(input))
    .select('id')
    .single()

  if (error) throw new Error(`createPosIntegration: ${error.message}`)
  return data!.id
}

export async function updatePosIntegration(
  id: string,
  updates: Partial<Pick<PosIntegration, 'name' | 'status' | 'webhookSecret' | 'fieldMapping' | 'credentials'>>
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const row = toUpdateRow(updates)
  const { error } = await supabase
    .from('pos_integrations')
    .update(row)
    .eq('id', id)

  if (error) throw new Error(`updatePosIntegration: ${error.message}`)
}

export async function deletePosIntegration(
  id: string
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('pos_integrations')
    .delete()
    .eq('id', id)

  if (error) throw new Error(`deletePosIntegration: ${error.message}`)
}

function toInsertRow(input: Omit<PosIntegration, 'id' | 'createdAt' | 'updatedAt'>) {
  return {
    restaurant_id: input.restaurantId,
    provider: input.provider,
    name: input.name,
    status: input.status,
    webhook_secret: input.webhookSecret,
    field_mapping: input.fieldMapping,
    credentials: input.credentials,
  }
}

function toUpdateRow(
  updates: Partial<Pick<PosIntegration, 'name' | 'status' | 'webhookSecret' | 'fieldMapping' | 'credentials'>>
): Record<string, unknown> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (updates.name !== undefined) row.name = updates.name
  if (updates.status !== undefined) row.status = updates.status
  if (updates.webhookSecret !== undefined) row.webhook_secret = updates.webhookSecret
  if (updates.fieldMapping !== undefined) row.field_mapping = updates.fieldMapping
  if (updates.credentials !== undefined) row.credentials = updates.credentials
  return row
}

function mapRow(row: Record<string, unknown>): PosIntegration {
  return {
    id: row.id as string,
    restaurantId: row.restaurant_id as string,
    provider: row.provider as PosIntegration['provider'],
    name: row.name as string,
    status: row.status as PosIntegration['status'],
    webhookSecret: (row.webhook_secret as string) ?? null,
    fieldMapping: (row.field_mapping as PosIntegration['fieldMapping']) ?? null,
    credentials: (row.credentials as Record<string, unknown>) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}
