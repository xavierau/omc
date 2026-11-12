import { RealtimeChannel } from '@supabase/supabase-js'
import { createBrowserSupabaseClient } from '@/infrastructure/supabase/client'

export const REALTIME_CHANNEL = 'dashboard-events'

export interface RealtimeEvent {
  id: string
  type: string
  memberName: string | null
  dataJson: Record<string, unknown>
  createdAt: string
}

export function subscribeToDashboardEvents(
  onEvent: (event: RealtimeEvent) => void,
  onStatus?: (status: string) => void
): RealtimeChannel {
  const supabase = createBrowserSupabaseClient()

  const channel = supabase
    .channel(REALTIME_CHANNEL)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'events',
      },
      async (payload) => {
        const row = payload.new as Record<string, unknown>
        const memberName = await fetchMemberName(
          supabase,
          row.member_id as string | null
        )

        onEvent({
          id: row.id as string,
          type: row.type as string,
          memberName,
          dataJson: (row.data_json as Record<string, unknown>) ?? {},
          createdAt: row.created_at as string,
        })
      }
    )
    .subscribe((status) => {
      onStatus?.(status)
    })

  return channel
}

async function fetchMemberName(
  supabase: ReturnType<typeof createBrowserSupabaseClient>,
  memberId: string | null
): Promise<string | null> {
  if (!memberId) return null

  const { data } = await supabase
    .from('members')
    .select('name')
    .eq('id', memberId)
    .single()

  return data?.name ?? null
}

export function unsubscribeFromChannel(channel: RealtimeChannel) {
  channel.unsubscribe()
}
