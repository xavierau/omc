-- 1. Prevent updates to paid commission records (TOCTOU protection)
CREATE OR REPLACE FUNCTION prevent_paid_commission_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'paid' AND NEW.status != 'paid' THEN
    RAISE EXCEPTION 'Cannot modify a paid commission record (id: %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER guard_paid_commissions
  BEFORE UPDATE ON referrer_commissions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_paid_commission_update();

-- 2. Aggregation RPC: sum earnings by referrer
CREATE OR REPLACE FUNCTION get_referrer_earnings(p_referrer_id UUID)
RETURNS TABLE(total NUMERIC, pending NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(total_commission), 0) AS total,
    COALESCE(SUM(CASE WHEN status = 'pending' THEN total_commission ELSE 0 END), 0) AS pending
  FROM referrer_commissions
  WHERE referrer_id = p_referrer_id;
END;
$$ LANGUAGE plpgsql STABLE;
