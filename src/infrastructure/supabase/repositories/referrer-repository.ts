import { createServerSupabaseClient } from '../client'
import type { Referrer, ReferrerStatus } from '@/domain/entities/referrer'
import {
  type CreateReferrerInput,
  mapRowToReferrer,
  mapReferrerToInsert,
  mapReferrerToUpdate,
} from './referrer-mapper'

export async function createReferrer(
  input: CreateReferrerInput
): Promise<Referrer> {
  const supabase = createServerSupabaseClient()
  const row = mapReferrerToInsert(input)

  const { data, error } = await supabase
    .from('referrers')
    .insert(row)
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(`createReferrer: ${error?.message}`)
  }
  return mapRowToReferrer(data)
}

export async function updateReferrer(
  id: string,
  input: Partial<CreateReferrerInput> & { status?: ReferrerStatus }
): Promise<Referrer> {
  const supabase = createServerSupabaseClient()
  const row = mapReferrerToUpdate(input)

  const { data, error } = await supabase
    .from('referrers')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(`updateReferrer: ${error?.message}`)
  }
  return mapRowToReferrer(data)
}

export async function findReferrerById(
  id: string
): Promise<Referrer | null> {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase
    .from('referrers')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`findReferrerById: ${error.message}`)
  }
  return data ? mapRowToReferrer(data) : null
}

export async function listReferrers(limit = 100): Promise<Referrer[]> {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase
    .from('referrers')
    .select('*')
    .order('name', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`listReferrers: ${error.message}`)
  return (data ?? []).map(mapRowToReferrer)
}

export async function listActiveReferrers(limit = 100): Promise<Referrer[]> {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase
    .from('referrers')
    .select('*')
    .eq('status', 'active')
    .order('name', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`listActiveReferrers: ${error.message}`)
  return (data ?? []).map(mapRowToReferrer)
}
