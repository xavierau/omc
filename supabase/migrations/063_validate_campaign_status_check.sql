-- Validate the NOT VALID constraint added in migration 062 (issue #102
-- review round 3).
--
-- Each migration file runs in its own transaction. VALIDATE CONSTRAINT run
-- in the SAME transaction as the ADD CONSTRAINT ... NOT VALID that
-- registered it would still execute under the ACCESS EXCLUSIVE lock that
-- statement holds for the rest of the transaction — the split into a
-- separate migration is what actually buys the lighter SHARE UPDATE
-- EXCLUSIVE scan (concurrent reads/writes allowed) instead of blocking the
-- table for the full-table validation scan.

ALTER TABLE campaigns VALIDATE CONSTRAINT campaigns_status_check;
