// BOOK-013 (spec AC-14, AC-18): submit the new booking templates for every
// restaurant already in Simple booking mode, without waiting for its next
// settings save. One run per tenant of the same provisioning a Simple save
// runs (provision-booking-templates.ts):
//   - `changed` and `cancelled` (zh_hk + en) are submitted as new templates;
//   - a live `confirmed` without the check-in QR header gets its QR version
//     submitted as the slot's candidate; the old approved one keeps sending
//     until Meta approves the new one (the BOOK-002 candidate flow).
// Idempotent: a slot already submitted or pending at Meta is left alone.
// It SUBMITS TO META, so it is a release step for the owner, never a test.
//
// Usage (env from .env.local or the box):
//   npx tsx scripts/ops/backfill-booking-templates.ts            # dry run: lists the tenants
//   npx tsx scripts/ops/backfill-booking-templates.ts --apply    # submits, prints statuses per kind
import '../load-env'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { provisionBookingTemplatesFor } from '@/application/booking/booking-template-deps'
import { resolveBookingConfig } from '@/domain/value-objects/booking-config'

async function simpleTenants(): Promise<string[]> {
  const { data, error } = await createServerSupabaseClient().from('restaurants').select('id, booking_config')
  if (error) throw new Error(`restaurants: ${error.message}`)
  return ((data ?? []) as Array<{ id: string; booking_config: unknown }>)
    .filter((r) => resolveBookingConfig(r.booking_config).mode === 'simple')
    .map((r) => r.id)
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const ids = await simpleTenants()
  console.log(`${ids.length} restaurant(s) in Simple booking mode${apply ? '' : ' (dry run; pass --apply to submit)'}`)
  if (!apply) return void ids.forEach((id) => console.log(`  ${id}`))
  let failed = 0
  for (const id of ids) {
    try {
      const statuses = await provisionBookingTemplatesFor(id)
      const line = Object.entries(statuses).map(([kind, s]) => `${kind}=${s.en}/${s.zh_hk}`).join(' ')
      console.log(`  ${id} ${line}`)
    } catch (err) {
      failed += 1
      console.error(`  ${id} FAILED: ${(err as Error).message}`)
    }
  }
  if (failed > 0) throw new Error(`${failed} restaurant(s) failed`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-booking-templates failed:', (err as Error).message)
    process.exit(1)
  })
