-- Atomic cascade-delete of a member and their tenant-scoped data.
--
-- Context: the (restaurant_id, phone) unique index on `members` blocks
-- a phone number from re-joining after a demo. Staff need a reset
-- button that hard-deletes the member along with their receipts,
-- events, coupons, and POS transactions so the phone is free again.
--
-- Why an RPC: the Supabase JS client has no transaction API. Wrapping
-- the deletes (pos_transactions, events, coupons, receipts, and the
-- members row itself) in a plpgsql function gives us all-or-nothing
-- semantics plus a single place to re-check tenant ownership.
--
-- Why SECURITY DEFINER: staff/admin RLS policies may not grant DELETE
-- on every cascade table (events, pos_transactions). Running as the
-- function owner sidesteps per-table RLS and prevents the silent
-- zero-row deletes that would otherwise orphan rows while the API
-- still returned 204. The IF EXISTS tenant-ownership guard below
-- keeps the escalation safe: callers can only wipe members that
-- belong to their own restaurant.
--
-- ON DELETE action coverage for rows referencing `members(id)`:
--   * coupon_redemptions    -> CASCADE (auto)
--   * campaign_members      -> CASCADE (auto)
--   * receipts              -> CASCADE, but deleted explicitly here so
--                              the operation is order-independent and
--                              symmetrical with the other tables.
--   * coupons               -> SET NULL by default; deleted explicitly
--                              so demo reset actually removes the
--                              member's coupons (matches the UI copy
--                              and the 'demo reset' intent).
--   * events                -> SET NULL by default; deleted explicitly
--                              so the deleted member leaves no trail.
--   * pos_transactions      -> NO ACTION (would block the delete);
--                              explicit DELETE is required.
CREATE OR REPLACE FUNCTION delete_member_cascade(
  p_member_id UUID,
  p_restaurant_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Tenant-ownership re-check at the SQL layer (defense in depth).
  IF NOT EXISTS (
    SELECT 1 FROM members
    WHERE id = p_member_id
      AND restaurant_id = p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'Member not found or cross-tenant: % / %',
      p_member_id, p_restaurant_id;
  END IF;

  -- Deletes pos_transactions, events, coupons, receipts, then the
  -- member row itself. Order matters only where FK actions would
  -- otherwise block (pos_transactions NO ACTION); the rest are listed
  -- explicitly so behavior does not depend on FK cascade semantics.

  -- pos_transactions has NO ON DELETE clause (default NO ACTION), so this
  -- is required to avoid FK violation. If a concurrent inbound webhook
  -- inserts a pos_transaction for this member between the earlier deletes
  -- and this one, the transaction rolls back cleanly and the route returns
  -- 500 — acceptable for demo-reset scope.
  DELETE FROM pos_transactions WHERE member_id = p_member_id;
  DELETE FROM events           WHERE member_id = p_member_id;
  -- coupons.member_id is always the OWNING member for welcome/reward
  -- coupons (not a random redeemer). Deleting these CASCADEs to
  -- coupon_redemptions; no risk of nuking unrelated members' redemption
  -- history because the coupon's member_id identifies the owner.
  DELETE FROM coupons          WHERE member_id = p_member_id;
  DELETE FROM receipts         WHERE member_id = p_member_id;
  DELETE FROM members
    WHERE id = p_member_id
      AND restaurant_id = p_restaurant_id;
END;
$$;

-- Lock down execution: SECURITY DEFINER combined with a broad grant
-- (PUBLIC or `authenticated`) would let any logged-in browser session
-- call the RPC directly with attacker-controlled args. The internal
-- tenant-ownership check only validates (member_id, restaurant_id)
-- consistency — it does NOT verify the caller has access to that
-- restaurant. So we restrict the grant to service_role.
--
-- Server-side only — browser clients must go through
-- DELETE /api/dashboard/members/[id] which re-validates tenant
-- membership via getTenantContext() before invoking the RPC.
REVOKE EXECUTE ON FUNCTION public.delete_member_cascade(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_member_cascade(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_member_cascade(UUID, UUID) TO service_role;
