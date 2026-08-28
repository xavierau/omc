-- Per-campaign enqueue throttle for the scheduled-broadcast cron (issue #95).
--
-- `/api/cron/campaigns` is about to be scheduled every minute. It selects
-- `status='active' AND scheduled_at <= now()` and enqueues a BullMQ job for
-- each hit. `executeCampaign` claims the row (active -> sending) before it
-- sends, so duplicates cannot double-send — but a campaign that throws
-- BEFORE that claim (unapproved template, missing phone_number_id,
-- execution-time guardrail) stays `active` with a past `scheduled_at` and is
-- re-selected on every single tick, forever: 1440 ticks/day x 3 BullMQ
-- attempts, each doing full member resolution.
--
-- `last_enqueued_at` is a lease timestamp, not a state change. The cron takes
-- it with a compare-and-swap and only re-enqueues once the window lapses.
-- Deliberately NOT a status transition: moving the row to `sending` at
-- enqueue time would drop it out of getDueCampaigns' filter permanently if
-- the job were ever lost (Redis flush, worker down) — a one-way door with no
-- backstop. A stale lease self-heals; a lost row does not.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS last_enqueued_at TIMESTAMPTZ;

COMMENT ON COLUMN campaigns.last_enqueued_at IS
  'Lease taken by /api/cron/campaigns when it enqueues a send job. Throttles re-enqueue of a campaign that never leaves status=active. Not a lifecycle state.';
