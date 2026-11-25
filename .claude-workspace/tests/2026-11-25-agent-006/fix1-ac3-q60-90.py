#!/usr/bin/env python3
"""AC-3 supplement: 60/90-day windows; counts only."""
import base64, json, subprocess, sys, urllib.request
REF = "uzimqndenngebzgndlhd"
raw = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-w"], capture_output=True, text=True).stdout.strip()
if raw.startswith("go-keyring-base64:"): raw = base64.b64decode(raw.split(":", 1)[1]).decode()
def sql(q):
    r = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query/read-only",
        data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": f"Bearer {raw}", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "curl/8"})
    with urllib.request.urlopen(r, timeout=120) as resp: return json.loads(resp.read().decode() or "null")
for days in (60, 90):
    base = f"""FROM whatsapp_messages m LEFT JOIN whatsapp_templates t ON t.id = m.template_id AND t.restaurant_id = m.restaurant_id
      WHERE m.direction='outbound' AND m.campaign_id IS NOT NULL AND m.status IN ('sent','delivered','read')
        AND m.queued_at >= now() - interval '{days} days'"""
    q = {
     f"sends_{days}d": f"""SELECT count(*) AS accepted_campaign_sends,
         count(*) FILTER (WHERE m.template_id IS NOT NULL) AS with_template_id,
         count(*) FILTER (WHERE m.template_id IS NULL) AS without_template_id,
         count(DISTINCT m.campaign_id) AS campaigns, count(DISTINCT m.template_id) AS templates,
         count(*) FILTER (WHERE t.updated_at > m.queued_at) AS template_updated_after_send,
         count(DISTINCT t.id) FILTER (WHERE t.updated_at > m.queued_at) AS templates_updated_after_a_send {base}""",
     f"null_template_by_type_{days}d": f"""SELECT m.message_type, count(*) AS n {base} AND m.template_id IS NULL GROUP BY 1 ORDER BY 1""",
     f"updated_after_send_detail_{days}d": f"""SELECT row_number() OVER (ORDER BY count(*) DESC) AS template_n, t.status AS status_now,
         count(*) AS sends, round(extract(epoch FROM (t.updated_at - max(m.queued_at)))/3600, 1) AS hours_last_send_to_update
       {base} AND t.updated_at > m.queued_at GROUP BY t.id, t.status, t.updated_at ORDER BY 3 DESC""",
    }
    for k, s in q.items(): print(f"## {k}\n{json.dumps(sql(s), indent=1, default=str)}")
