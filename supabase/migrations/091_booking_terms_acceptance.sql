-- BOOK-009: a booking records that the diner accepted the restaurant's
-- booking terms, when, and the exact text accepted (spec AC-10, plan D3).
-- Plan: .claude-workspace/plans/2026-11-20-book-009-010-plan.md (threat R4:
-- the text is the restaurant's, not PII, so purge-booking-pii is unchanged).
-- Additive: no existing row changes. Apply BEFORE deploying the code that
-- reads these columns (the dashboard lists select them).

-- One statement per column (the schema-contract parser reads each ADD COLUMN).
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS terms_text TEXT;

-- Set together or not at all; the text is at most both languages (2 x 1,000
-- characters plus the blank line between them).
ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_terms_acceptance;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_terms_acceptance
  CHECK (
    (terms_accepted_at IS NULL AND terms_text IS NULL)
    OR (terms_accepted_at IS NOT NULL AND terms_text IS NOT NULL AND char_length(terms_text) BETWEEN 1 AND 2002)
  );
