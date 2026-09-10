import { createServerSupabaseClient } from '../client'

export interface EventRow {
  id: string
  type: string
  member_name: string | null
  data_json: Record<string, unknown>
  created_at: string
}

export interface EventListParams {
  restaurantId: string
  limit: number
  type?: string
}

export async function getEvents(params: EventListParams): Promise<EventRow[]> {
  const supabase = createServerSupabaseClient()
  const { restaurantId, limit, type } = params

  let query = supabase
    .from('events')
    .select('id, type, data_json, created_at, members(name)')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (type) {
    query = query.eq('type', type)
  }

  const { data, error } = await query

  if (error) throw new Error(`getEvents: ${error.message}`)

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    type: row.type as string,
    member_name: extractMemberName(row.members),
    data_json: (row.data_json as Record<string, unknown>) ?? {},
    created_at: row.created_at as string,
  }))
}

function extractMemberName(members: unknown): string | null {
  if (Array.isArray(members) && members.length > 0) {
    return (members[0] as { name: string }).name ?? null
  }
  if (members && typeof members === 'object' && 'name' in members) {
    return (members as { name: string }).name ?? null
  }
  return null
}

export async function createEvent(params: {
  restaurantId: string
  memberId: string | null
  type: string
  dataJson?: Record<string, unknown>
  source?: string
}): Promise<string> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('events')
    .insert({
      restaurant_id: params.restaurantId,
      member_id: params.memberId,
      type: params.type,
      data_json: params.dataJson ?? {},
      source: params.source ?? null,
    })
    .select('id')
    .single()

  if (error) throw new Error(`createEvent: ${error.message}`)
  if (!data) throw new Error('createEvent: no data returned')
  return data.id as string
}
