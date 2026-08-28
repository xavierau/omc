CREATE TABLE admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_created_at ON admin_audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_user_id ON admin_audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON admin_audit_logs(resource_type, resource_id);

-- RLS: only platform admins can read audit logs
ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_select ON admin_audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid())
);

-- Inserts are done via service role (bypasses RLS)
