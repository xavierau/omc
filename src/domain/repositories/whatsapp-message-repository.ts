import type {
  WhatsAppMessage,
  StatusUpdate,
} from '../entities/whatsapp-message'

/**
 * Contract for the `whatsapp_messages` writer/reader. The Supabase
 * implementation lives in `src/infrastructure/supabase/repositories/`
 * and is the SOLE writer to the table (service role bypasses RLS).
 */
export interface WhatsAppMessageRepository {
  /** Insert a queued (status='queued', kapso_message_id=NULL) row. */
  insertQueued(message: WhatsAppMessage): Promise<void>

  /**
   * After the BSP returns, attach the wamid, persist the raw send response
   * for forensic replay, and progress status `queued` -> `sent`. Implementations
   * MUST guard on `status='queued'` so a racing webhook update to
   * delivered/read is not regressed.
   */
  attachKapsoMessageId(
    id: string,
    kapsoMessageId: string,
    raw: Record<string, unknown> | null
  ): Promise<void>

  findByKapsoMessageId(
    kapsoMessageId: string
  ): Promise<WhatsAppMessage | null>

  /**
   * Webhook handler update path. Returns the post-update entity (or null if
   * no row matched). Implementations are responsible for honoring the
   * progression rules in {@link WhatsAppMessage.applyStatusUpdate}.
   */
  applyStatusUpdate(
    kapsoMessageId: string,
    update: StatusUpdate
  ): Promise<WhatsAppMessage | null>

  /**
   * When the BSP call throws BEFORE returning a wamid, mark the locally-
   * generated row failed by primary key. Distinct from the webhook update
   * path, which keys on `kapso_message_id` and never matches these rows.
   */
  markFailedNoBspId(
    id: string,
    error: { title: string; details?: string }
  ): Promise<void>
}
