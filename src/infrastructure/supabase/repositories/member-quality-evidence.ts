// MEM-001b: why a member has their contact-quality rating. The rating comes
// from the same classifier and the same inputs (outbound, in-window,
// delivered incl. read / failed, unreachable flag) as the list column, so the
// two never disagree: counts come from the same member_delivery_quality RPC
// (migration 080) as the list. The newest messages are a separate scoped query,
// limited to RECENT_LIMIT; message text is never selected.

import { createServerSupabaseClient } from '../client'
import {
  CONTACT_QUALITY_THRESHOLDS,
  CONTACT_QUALITY_WINDOW_DAYS,
  classifyContactQuality,
  type ContactQuality,
} from '@/domain/value-objects/contact-quality'

const MESSAGE_COLUMNS = 'id, queued_at, status, category, template_name, error_code, error_title'
const RECENT_LIMIT = 20

interface MessageRow {
  id: string
  queued_at: string
  status: string
  category: string
  template_name: string | null
  error_code: string | null
  error_title: string | null
}

export interface RecentMessage {
  id: string
  queuedAt: string
  status: string
  category: string
  templateName: string | null
  errorCode: string | null
  errorTitle: string | null
}

export interface MemberQualityEvidence {
  quality: ContactQuality
  windowDays: number
  thresholds: { green: number; yellow: number }
  counts: { delivered: number; read: number; failed: number; pending: number }
  unreachableAt: string | null
  pmmThrottledUntil: string | null
  recentMessages: RecentMessage[]
}

interface CountsRow {
  delivered: number | string
  read: number | string
  failed: number | string
  pending: number | string
}

export async function getMemberQualityEvidence(
  memberId: string,
  restaurantId: string
): Promise<MemberQualityEvidence | null> {
  const supabase = createServerSupabaseClient()
  const since = new Date(Date.now() - CONTACT_QUALITY_WINDOW_DAYS * 86_400_000).toISOString()

  const [memberRes, countsRes, messagesRes] = await Promise.all([
    supabase
      .from('members')
      .select('unreachable_at, pmm_throttled_until')
      .eq('id', memberId)
      .eq('restaurant_id', restaurantId)
      .maybeSingle(),
    supabase.rpc('member_delivery_quality', {
      p_restaurant_id: restaurantId,
      p_member_ids: [memberId],
      p_window_days: CONTACT_QUALITY_WINDOW_DAYS,
    }),
    supabase
      .from('whatsapp_messages')
      .select(MESSAGE_COLUMNS)
      .eq('restaurant_id', restaurantId)
      .eq('member_id', memberId)
      .eq('direction', 'outbound')
      .gte('queued_at', since)
      .order('queued_at', { ascending: false })
      .limit(RECENT_LIMIT),
  ])

  if (memberRes.error) throw new Error(`member_quality_evidence(members): ${memberRes.error.message}`)
  if (countsRes.error) throw new Error(`member_quality_evidence(counts): ${countsRes.error.message}`)
  if (messagesRes.error) throw new Error(`member_quality_evidence(messages): ${messagesRes.error.message}`)
  if (!memberRes.data) return null
  const countsRow = ((countsRes.data ?? []) as CountsRow[])[0]

  return buildEvidence(memberRes.data as MemberFlags, countsRow, (messagesRes.data ?? []) as MessageRow[])
}

interface MemberFlags {
  unreachable_at: string | null
  pmm_throttled_until: string | null
}

function buildEvidence(flags: MemberFlags, row: CountsRow | undefined, messages: MessageRow[]): MemberQualityEvidence {
  // bigint columns can arrive as strings; coerce. No row = member has no in-window messages.
  const counts = {
    delivered: Number(row?.delivered ?? 0),
    read: Number(row?.read ?? 0),
    failed: Number(row?.failed ?? 0),
    pending: Number(row?.pending ?? 0),
  }
  return {
    quality: classifyContactQuality({
      delivered: counts.delivered,
      failed: counts.failed,
      unreachable: flags.unreachable_at !== null,
    }),
    windowDays: CONTACT_QUALITY_WINDOW_DAYS,
    thresholds: { ...CONTACT_QUALITY_THRESHOLDS },
    counts,
    unreachableAt: flags.unreachable_at,
    pmmThrottledUntil: flags.pmm_throttled_until,
    recentMessages: messages.map(toRecentMessage),
  }
}

function toRecentMessage(r: MessageRow): RecentMessage {
  return {
    id: r.id,
    queuedAt: r.queued_at,
    status: r.status,
    category: r.category,
    templateName: r.template_name,
    errorCode: r.error_code,
    errorTitle: r.error_title,
  }
}

/** Never throws: any failure yields null so the rest of the detail still returns. */
export async function getMemberQualityEvidenceSafe(
  memberId: string,
  restaurantId: string
): Promise<MemberQualityEvidence | null> {
  try {
    return await getMemberQualityEvidence(memberId, restaurantId)
  } catch (error) {
    console.warn('member quality evidence failed; returning null', error)
    return null
  }
}
