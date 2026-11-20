import { RecordingPublisher } from '@/test-utils/recording-publisher'
import type { IntegrationEvent } from '@/domain/entities/integration-event'
import { runIntegrationEventPublisherContract } from './integration-event-publisher.contract'

runIntegrationEventPublisherContract('fake: RecordingPublisher', () => {
  const publisher = new RecordingPublisher()
  return {
    publisher,
    listPublished: async (restaurantId: string): Promise<IntegrationEvent[]> =>
      publisher.events.filter((e) => e.restaurantId === restaurantId),
  }
})

// `emit-integration-event.ts` now exists (WI-6), but the real-adapter
// invocation below is DEFERRED, not filled in -- disclosed rather than
// silently skipped. The local Postgres at 127.0.0.1:54322 is a SHARED
// instance other concurrent INT-001 dev agents (WI-3) may be using right
// now, and its `postgres` database is already at `supabase_migrations
// .schema_migrations` version 103 -- a different branch's migration
// history entirely (this worktree's own migrations top out at 072; see
// plan Risk R5). Running this worktree's 001-072 against that shared
// database risks schema collisions and disrupting a concurrent session.
// The safe path is an ISOLATED `CREATE DATABASE scratch_int001_wi6`
// stubbed with `auth.uid/jwt/role`, `extensions`, and whichever of
// `storage.*`/`supabase_realtime` migrations 002-072 need (grep found:
// 002, 011, 012, 018, 032, 034, 044, 046, 048, 051, 055) -- the same shape
// as WI-1's own (uncommitted, scratchpad-only) scratch-db-069.sh. Building
// that harness is a real, separate effort WI-1 already spent a session on;
// re-deriving it here was not worth displacing the rest of WI-6's scope
// for. Coverage in its place: WI-1's own scratch-DB Assertion D already
// proved the migration-071 trigger fans out exactly one delivery row for a
// subscribed+enabled+acked integration; `emit-integration-event.test.ts`
// (WI-6) covers the application layer (fast-path enqueue, idempotent
// markEnqueued, never-throws-past-the-insert) against mocked repositories.
// What's NOT independently re-verified: the trigger's EXCLUSION cases
// (disabled / no PII ack / event type not in outbound_events / multiple
// integrations on one restaurant) against a real Postgres instance.
// Flagged as a gap for a follow-up scratch-DB task, not a silent omission.
//
//   runIntegrationEventPublisherContract('real: emitIntegrationEvent', async () => { ... })
