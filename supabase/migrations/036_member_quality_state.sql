-- WAQ-001 / WAQ-003: per-recipient quality state.
-- pmm_throttled_until: set on Meta error 131049 (PMM hit). Send paths must
--   skip the recipient until now() > pmm_throttled_until. Cleared lazily.
-- unreachable_at: set once on 131026 (recipient cannot receive). One-way
--   flag for this slice; ops clears via SQL until WAQ-009 ships an admin UI.
--
-- Setting these columns is in scope for WAQ-001/003. Reading them at send
-- time (cooldown gate) is WAQ-007.

ALTER TABLE members
  ADD COLUMN pmm_throttled_until TIMESTAMPTZ,
  ADD COLUMN unreachable_at TIMESTAMPTZ;

-- Cooldown queries during send (WAQ-007 will use this; we add the index now
-- so the WAQ-007 PR is purely application code).
CREATE INDEX idx_members_pmm_throttled_until
  ON members(pmm_throttled_until)
  WHERE pmm_throttled_until IS NOT NULL;

CREATE INDEX idx_members_unreachable_at
  ON members(unreachable_at)
  WHERE unreachable_at IS NOT NULL;
