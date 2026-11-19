-- LOCAL STACK ONLY (not a migration): Supabase CLI 2.109 local stacks grant no table privileges
-- in public; hosted projects carry these legacy defaults. Functions are NOT widened, so the
-- 064/079/085 REVOKE lockdowns stay as the migrations left them.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
