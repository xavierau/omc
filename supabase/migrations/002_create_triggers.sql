-- This trigger function will be used to broadcast new events via Supabase Realtime
-- For now it's a placeholder; the actual broadcast happens via Supabase client-side subscriptions
CREATE OR REPLACE FUNCTION notify_new_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Supabase Realtime will pick up inserts on this table automatically
  -- when clients subscribe to the events table changes
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_new_event
  AFTER INSERT ON events
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_event();

-- Enable Realtime for the events table
-- Supabase uses the 'supabase_realtime' publication for postgres_changes
-- This needs to be run after table creation
ALTER PUBLICATION supabase_realtime ADD TABLE events;

-- Also add members table for realtime member count updates
ALTER PUBLICATION supabase_realtime ADD TABLE members;
