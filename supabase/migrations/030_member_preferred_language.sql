BEGIN;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NULL;

-- Attach CHECK idempotently
DO $$ BEGIN
  ALTER TABLE members
    ADD CONSTRAINT members_preferred_language_chk
    CHECK (preferred_language IS NULL OR preferred_language IN ('en','zh_hk'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- No backfill. No index. Column stays NULL until first inbound message or
-- explicit LANG command. Resolver falls back to restaurant default.

COMMIT;
