-- Add integration_error to events type CHECK
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN ('join','redeem','receipt','campaign','points','unsubscribe',
    'reward_redeem','pos_transaction','pos_refund','pos_customer_link','integration_error'));
