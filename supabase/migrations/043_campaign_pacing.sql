-- WAQ-010 Phase 1 — engagement-tier probe pacing.
--
-- Replaces the hard-coded BATCH_SIZE=20/BATCH_DELAY_MS=1000 in
-- execute-campaign-batch.ts with a per-tenant strategy:
--   * 'engagement_tier' (default) — recipients sorted by last_visit_at DESC,
--      then chunked: probe_chunk_size first, scale_chunk_size thereafter.
--   * 'naive' — preserved as opt-out for tenants on the legacy behaviour.
--
-- Active-hours columns are stored now so a future Phase 2 cron can gate the
-- next chunk to a tenant's local 10am–10pm window. Phase 1 reads them only
-- for observability (logged at probe boundary).

ALTER TABLE tenant_campaign_settings
  ADD COLUMN pacing_strategy TEXT NOT NULL DEFAULT 'engagement_tier'
    CHECK (pacing_strategy IN ('engagement_tier', 'naive')),
  ADD COLUMN active_hours_start_local TIME NOT NULL DEFAULT '10:00:00',
  ADD COLUMN active_hours_end_local TIME NOT NULL DEFAULT '22:00:00',
  ADD COLUMN tenant_timezone TEXT NOT NULL DEFAULT 'Asia/Hong_Kong',
  ADD COLUMN probe_chunk_size INTEGER NOT NULL DEFAULT 100
    CHECK (probe_chunk_size > 0 AND probe_chunk_size <= 1000),
  ADD COLUMN scale_chunk_size INTEGER NOT NULL DEFAULT 100
    CHECK (scale_chunk_size > 0 AND scale_chunk_size <= 1000);

COMMENT ON COLUMN tenant_campaign_settings.pacing_strategy IS
  'engagement_tier: sort recipients by last_visit_at DESC, send probe-then-scale chunks. naive: send all in insertion order. WAQ-010 Phase 1 ships engagement_tier as default.';
COMMENT ON COLUMN tenant_campaign_settings.probe_chunk_size IS
  'Size of the FIRST chunk in an engagement-tier run. Per WAQ-010 spec the probe targets the most-engaged tier so KPI risk is bounded.';
COMMENT ON COLUMN tenant_campaign_settings.scale_chunk_size IS
  'Size of subsequent chunks after the probe. Phase 2 will gate scale chunks behind probe-KPI checks; Phase 1 just chunks straight through.';
COMMENT ON COLUMN tenant_campaign_settings.active_hours_start_local IS
  '(unused in Phase 1) Local-time start of tenant''s send window. Phase 2 cron will gate scale chunks to this window.';
