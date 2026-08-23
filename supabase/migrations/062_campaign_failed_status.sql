-- Terminal 'failed' status for campaigns (issue #102 Part B).
--
-- getDueCampaigns() selects status='active' AND scheduled_at <= now() with
-- nothing that ever clears the condition once a campaign's every send
-- attempt is exhausted. A campaign that fails the WAQ-011 template-review
-- gate (or any other guard) on every BullMQ attempt stays 'active' forever
-- and is re-enqueued on every cron tick — observed as 6,642 failed jobs
-- against one campaign in prod. The queue worker's 'failed' handler now
-- transitions the campaign to 'failed' once attemptsMade exhausts the job's
-- configured attempts, which drops it out of getDueCampaigns' filter.
--
-- `failure_reason` records why, so the fix in the same issue that surfaces
-- worker-side failures to the tenant (terminal status + reason on the card)
-- has something to display instead of only a console.error.

-- ADD CONSTRAINT ... NOT VALID takes only a brief ACCESS EXCLUSIVE lock to
-- register the constraint (no existing-row scan). VALIDATE CONSTRAINT then
-- scans under SHARE UPDATE EXCLUSIVE, which does not block concurrent reads
-- or writes — avoids holding campaigns under ACCESS EXCLUSIVE for the
-- duration of a full-table validation scan (review round 2, #102).
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('draft', 'active', 'sending', 'paused', 'completed', 'failed'))
  NOT VALID;
ALTER TABLE campaigns VALIDATE CONSTRAINT campaigns_status_check;

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS failure_reason text;

COMMENT ON COLUMN campaigns.failure_reason IS
  'Set when the queue worker exhausts every retry attempt for a campaign send (issue #102). Null unless status=failed.';
