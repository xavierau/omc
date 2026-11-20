-- Add 'sending' to campaigns status constraint.
--
-- The application introduced a `sending` transitional state (active -> sending
-- -> completed) for atomic claim-on-execute, but no migration ever extended
-- the check constraint. Every campaign send was failing with a constraint
-- violation that was silently swallowed by transitionCampaignStatus, surfacing
-- as the misleading "not active or already processing" error.

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('draft', 'active', 'sending', 'paused', 'completed'));
