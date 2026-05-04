import { randomUUID } from 'crypto'
import { getRestaurantName } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { insertConsentRecord } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { ConsentRecord } from '@/domain/entities/consent-record'
import { ConsentImportError } from '@/domain/repositories/consent-record-repository'

type LogFn = (
  level: 'info' | 'warn' | 'error',
  event: string,
  data: unknown
) => void

export interface JoinConsentArgs {
  restaurantId: string
  memberId: string
  phoneE164: string
  sourceReference: string | undefined
  log: LogFn
}

/**
 * WAQ-004: persist proof of consent every time a contact opts in via the
 * WhatsApp JOIN keyword. The wamid is the source_reference; the restaurant
 * name is captured at consent time so any audit can show the user exactly
 * what business they consented to.
 *
 * Failures are logged and swallowed: not writing a consent record must not
 * roll back the member registration that already succeeded above.
 */
export async function recordJoinConsent(args: JoinConsentArgs): Promise<void> {
  try {
    const businessName = await getRestaurantName(args.restaurantId).catch(
      () => null
    )
    const record = ConsentRecord.grant({
      id: randomUUID(),
      restaurantId: args.restaurantId,
      memberId: args.memberId,
      phoneE164: args.phoneE164,
      category: 'marketing',
      source: 'whatsapp_join_keyword',
      sourceReference: args.sourceReference ?? null,
      businessNameShown: businessName,
      grade: 'strong',
    })
    await insertConsentRecord(record)
  } catch (err) {
    if (
      err instanceof ConsentImportError &&
      err.reason === 'duplicate_active'
    ) {
      // Re-joining is fine; the existing active consent stands.
      return
    }
    args.log('warn', 'handler.consent_write_failed', {
      route: 'JOIN',
      error: String(err),
    })
  }
}
