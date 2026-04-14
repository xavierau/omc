-- Atomic points adjustment with row-level locking
CREATE OR REPLACE FUNCTION adjust_member_points(
  p_member_id UUID,
  p_delta INTEGER,
  p_reject_negative BOOLEAN DEFAULT FALSE
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_current INTEGER;
  v_new INTEGER;
BEGIN
  SELECT points_balance INTO v_current
  FROM members WHERE id = p_member_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found: %', p_member_id;
  END IF;

  v_new := v_current + p_delta;

  IF p_reject_negative AND v_new < 0 THEN
    RAISE EXCEPTION 'Insufficient points balance. Current: %, requested: %', v_current, ABS(p_delta);
  END IF;

  IF v_new < 0 THEN
    v_new := 0;
  END IF;

  UPDATE members SET points_balance = v_new WHERE id = p_member_id;
  RETURN v_new;
END;
$$;
