// MEM-001b: why a member has their contact-quality rating. The rating comes
// from the same classifier and the same inputs (outbound, in-window,
// delivered incl. read / failed, unreachable flag) as the list column, so the
// two never disagree. Reads whatsapp_messages directly, scoped by tenant AND
// member in the query itself; message text is never selected.

import { createServerSupabaseClient } from '../client'
import {
  CONTACT_QUALITY_THRESHOLDS,
  CONTACT_QUALITY_WINDOW_DAYS,
  classifyContactQuality,
  type ContactQuality,
} from '@/domain/value-objects/contact-quality'

const MESSAGE_COLUMNS = 'id, queued_at, status, category, template_name, error_code, error_title'
const RECENT_LIMIT = 20
// Safety bound. Beyond it counts would be partial and could disagree with the
// list RPC, so we fail (-> null evidence) rather than show a wrong explanation.
const ROW_CAP = 5000

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

export async function getMemberQualityEvidence(
  memberId: string,
  restaurantId: string
): Promise<MemberQualityEvidence | null> {
  const supabase = createServerSupabaseClient()
  const since = new Date(Date.now() - CONTACT_QUALITY_WINDOW_DAYS * 86_400_000).toISOString()

  const [memberRes, messagesRes] = await Promise.all([
    supabase
      .from('members')
      .select('unreachable_at, pmm_throttled_until')
      .eq('id', memberId)
      .eq('restaurant_id', restaurantId)
      .single(),
    supabase
      .from('whatsapp_messages')
      .select(MESSAGE_COLUMNS)
      .eq('restaurant_id', restaurantId)
      .eq('member_id', memberId)
      .eq('direction', 'outbound')
      .gte('queued_at', since)
      .order('queued_at', { ascending: false })
      .limit(ROW_CAP),
  ])

  if (memberRes.error) throw new Error(`member_quality_evidence(members): ${memberRes.error.message}`)
  if (messagesRes.error) throw new Error(`member_quality_evidence(messages): ${messagesRes.error.message}`)
  if (!memberRes.data) return null
  const rows = (messagesRes.data ?? []) as MessageRow[]
  if (rows.length >= ROW_CAP) throw new Error('member_quality_evidence: row cap reached')

  return buildEvidence(memberRes.data as MemberFlags, rows)
}

interface MemberFlags {
  unreachable_at: string | null
  pmm_throttled_until: string | null
}

function buildEvidence(flags: MemberFlags, rows: MessageRow[]): MemberQualityEvidence {
  const count = (...statuses: string[]) => rows.filter((r) => statuses.includes(r.status)).length
  const counts = {
    delivered: count('delivered', 'read'),
    read: count('read'),
    failed: count('failed'),
    pending: count('queued', 'sent'),
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
    recentMessages: rows.slice(0, RECENT_LIMIT).map(toRecentMessage),
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
