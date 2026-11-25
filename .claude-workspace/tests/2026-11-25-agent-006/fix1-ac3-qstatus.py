#!/usr/bin/env python3
"""AC-3 reconcile: campaign sends (all statuses, outbound) in 60 days by status x template_id present; counts only."""
import base64, json, subprocess, urllib.request
REF = "uzimqndenngebzgndlhd"
raw = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-w"], capture_output=True, text=True).stdout.strip()
if raw.startswith("go-keyring-base64:"): raw = base64.b64decode(raw.split(":", 1)[1]).decode()
q = """SELECT m.status, m.message_type, (m.template_id IS NOT NULL) AS has_template_id, count(*) AS n
  FROM whatsapp_messages m WHERE m.direction='outbound' AND m.campaign_id IS NOT NULL AND m.queued_at >= now() - interval '60 days'
  GROUP BY 1,2,3 ORDER BY 1,2,3"""
r = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query/read-only", data=json.dumps({"query": q}).encode(), method="POST",
    headers={"Authorization": f"Bearer {raw}", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "curl/8"})
print("## campaign_sends_60d_by_status_type_template\n" + json.dumps(json.loads(urllib.request.urlopen(r, timeout=120).read()), indent=1))
