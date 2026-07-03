-- WAQ-009: auto-pause + auto-throttle bookkeeping driven by Meta quality
-- transitions (see migration 039 + src/app/api/webhooks/whatsapp/quality-handlers).
--
-- Stored values (daily_campaign_limit, monthly_send_limit) are NEVER mutated by
-- auto-throttle. We track only the current quality-driven runtime modifier.
-- The send-side guardrail multiplies the stored limit by `auto_throttle_factor`
-- at read time so undoing the throttle is a single column write, not a backfill.
--
-- Independence from manual ops pause: `campaign_paused` (migration 016) reflects
-- the manual ops switch. `auto_pause_active` is the quality-driven switch. The
-- guardrail check denies if either is true. Manual unpause clears
-- `campaign_paused` only; clearing `auto_pause_active` requires an explicit
-- platform-admin override (clearTenantAutoQualityFlags).
--
-- GREEN-recovery from YELLOW/RED does NOT auto-clear these columns — per Q1
-- resolution we require a manual override so a flapping signal does not flip
-- a tenant back to full speed without ops review (WAQ-013 alerts will surface
-- the recovery for clearance).

ALTER TABLE tenant_campaign_settings
  ADD COLUMN auto_throttle_factor NUMERIC(3, 2) NOT NULL DEFAULT 1.00
    CHECK (auto_throttle_factor > 0 AND auto_throttle_factor <= 1),
  ADD COLUMN auto_pause_active BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN auto_pause_reason TEXT
    CHECK (auto_pause_reason IS NULL OR auto_pause_reason IN ('quality_red_auto', 'quality_yellow_throttle')),
  -- Set ONLY when auto_pause_active flips to true (i.e. by applyAutoPause).
  -- Cleared (set to NULL) on platform-admin clear (clearAutoQualityFlags).
  -- NOT touched by auto-throttle transitions — auto_throttle_factor changes
  -- alone leave this column unchanged. WAQ-013 alerting reads this column
  -- as "tenant has been auto-paused since X".
  ADD COLUMN auto_pause_set_at TIMESTAMPTZ;

-- Hot path for ops dashboards: list every tenant currently auto-paused.
CREATE INDEX idx_campaign_settings_auto_paused
  ON tenant_campaign_settings(auto_pause_active) WHERE auto_pause_active = true;
