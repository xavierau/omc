// INVARIANT (WAQ-001): the SOLE writer to the `whatsapp_messages` table.
// `createServerSupabaseClient()` uses SUPABASE_SERVICE_ROLE_KEY which
// bypasses RLS — there are no INSERT/UPDATE policies on the table by
// design. Do NOT add a browser-side write path; route every mutation
// through the named functions below so callers stay observable.

import { createServerSupabaseClient } from '../client'
import {
  WhatsAppMessage,
  type StatusUpdate,
} from '@/domain/entities/whatsapp-message'
import {
  toEntity,
  toQueuedRow,
  type WhatsAppMessageRow,
} from './whatsapp-message-mapper'

export async function insertQueuedMessage(m: WhatsAppMessage): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('whatsapp_messages')
    .insert(toQueuedRow(m))
  if (error) throw new Error(`insertQueuedMessage: ${error.message}`)
}

export async function attachKapsoMessageId(
  id: string,
  kapsoMessageId: string,
  raw: Record<string, unknown> | null
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('whatsapp_messages')
    .update({
      kapso_message_id: kapsoMessageId,
      raw_send_response: raw,
      status: 'sent',
      sent_at: new Date().toISOString(),
    })
    .eq('id', id)
    // Status guard: only progress queued -> sent. If a webhook handler has
    // already advanced the row to delivered/read, this UPDATE matches no rows
    // and becomes a no-op rather than regressing the status.
    .eq('status', 'queued')
  if (error) throw new Error(`attachKapsoMessageId: ${error.message}`)
}

export async function findMessageByKapsoId(
  kapsoMessageId: string
): Promise<WhatsAppMessage | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('*')
    .eq('kapso_message_id', kapsoMessageId)
    .maybeSingle()
  if (error) throw new Error(`findMessageByKapsoId: ${error.message}`)
  if (!data) return null
  return toEntity(data as WhatsAppMessageRow)
}

export async function applyStatusUpdateByKapsoId(
  kapsoMessageId: string,
  update: StatusUpdate
): Promise<WhatsAppMessage | null> {
  const current = await findMessageByKapsoId(kapsoMessageId)
  if (!current) return null
  const next = current.applyStatusUpdate(update)
  if (next === current) return current
  return persistStatusUpdate(next)
}

async function persistStatusUpdate(
  m: WhatsAppMessage
): Promise<WhatsAppMessage> {
  const supabase = createServerSupabaseClient()
  const s = m.snapshot
  const { error } = await supabase
    .from('whatsapp_messages')
    .update({
      status: s.status,
      sent_at: s.sentAt,
      delivered_at: s.deliveredAt,
      read_at: s.readAt,
      failed_at: s.failedAt,
      error_code: s.errorCode,
      error_title: s.errorTitle,
      error_details: s.errorDetails,
    })
    .eq('id', s.id)
  if (error) throw new Error(`applyStatusUpdate: ${error.message}`)
  return m
}

export async function markFailedNoBspId(
  id: string,
  error: { title: string; details?: string }
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error: dbError } = await supabase
    .from('whatsapp_messages')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      error_title: error.title,
      error_details: error.details ?? null,
    })
    .eq('id', id)
  if (dbError) throw new Error(`markFailedNoBspId: ${dbError.message}`)
}
