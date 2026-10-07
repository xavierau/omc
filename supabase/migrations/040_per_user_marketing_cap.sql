-- WAQ-007: per-user marketing cooldown enforcer.
-- Q3 resolution 2026-05-04: per-user marketing cap is N=1 marketing template
-- per recipient per 24h by default. Tenants can opt up at their own quality
-- risk via this column.
--
-- The <=10 ceiling is a sanity guard. Meta's hard ceiling is 2/24h cross-brand,
-- so anything above 2 is unsafe — but we let tenants opt in within the bound
-- so a future high-trust pilot can experiment without a schema change.

ALTER TABLE tenant_campaign_settings
  ADD COLUMN per_user_marketing_cap INTEGER NOT NULL DEFAULT 1
    CHECK (per_user_marketing_cap >= 1 AND per_user_marketing_cap <= 10);
