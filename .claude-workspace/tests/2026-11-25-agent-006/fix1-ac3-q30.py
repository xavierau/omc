#!/usr/bin/env python3
"""AGENT-006 fix1 AC-3: read-only counts on prod (Supabase Management API read-only endpoint).
Token read in-process from the macOS keychain 'Supabase CLI', never printed. Counts only."""
import base64, json, subprocess, sys, urllib.request

REF = "uzimqndenngebzgndlhd"

def token():
    raw = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-w"], capture_output=True, text=True).stdout.strip()
    if raw.startswith("go-keyring-base64:"):
        raw = base64.b64decode(raw.split(":", 1)[1]).decode()
    if not raw: sys.exit("no token")
    return raw

TOK = token()

def sql(q):
    r = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query/read-only",
        data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": f"Bearer {TOK}", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "curl/8"})
    with urllib.request.urlopen(r, timeout=120) as resp:
        return json.loads(resp.read().decode() or "null")

SENDS = """FROM whatsapp_messages m
  WHERE m.direction='outbound' AND m.campaign_id IS NOT NULL
    AND m.status IN ('sent','delivered','read') AND m.queued_at >= now() - interval '30 days'"""

Q = {
 "window": "SELECT now() AS now, now() - interval '30 days' AS since",
 "sends_30d": f"""SELECT count(*) AS accepted_campaign_sends,
     count(*) FILTER (WHERE m.template_id IS NOT NULL) AS with_template_id,
     count(*) FILTER (WHERE m.template_id IS NULL) AS without_template_id,
     count(*) FILTER (WHERE m.template_id IS NULL AND m.message_type='text') AS without_template_text,
     count(*) FILTER (WHERE m.template_id IS NULL AND m.message_type='image') AS without_template_image,
     count(DISTINCT m.campaign_id) AS campaigns,
     count(DISTINCT m.template_id) AS templates {SENDS}""",
 "template_sends_vs_updated_at": f"""SELECT count(*) AS template_sends,
     count(*) FILTER (WHERE t.updated_at > m.queued_at) AS template_updated_after_send,
     round(100.0 * count(*) FILTER (WHERE t.updated_at > m.queued_at) / nullif(count(*),0), 1) AS pct,
     count(DISTINCT t.id) AS templates,
     count(DISTINCT t.id) FILTER (WHERE t.updated_at > m.queued_at) AS templates_updated_after_a_send,
     count(*) FILTER (WHERE t.id IS NULL) AS template_row_missing
   {SENDS.replace('FROM whatsapp_messages m', 'FROM whatsapp_messages m LEFT JOIN whatsapp_templates t ON t.id = m.template_id AND t.restaurant_id = m.restaurant_id')}
     AND m.template_id IS NOT NULL""",
 "updated_after_send_by_template": f"""SELECT row_number() OVER (ORDER BY count(*) DESC) AS template_n, t.status AS status_now,
     count(*) AS sends_after_which_updated,
     round(extract(epoch FROM (t.updated_at - max(m.queued_at)))/3600, 1) AS hours_from_last_such_send_to_update,
     round(extract(epoch FROM (t.updated_at - t.created_at))/86400, 1) AS days_created_to_updated
   {SENDS.replace('FROM whatsapp_messages m', 'FROM whatsapp_messages m JOIN whatsapp_templates t ON t.id = m.template_id AND t.restaurant_id = m.restaurant_id')}
     AND t.updated_at > m.queued_at
   GROUP BY t.id, t.status, t.updated_at, t.created_at ORDER BY 3 DESC""",
 "templates_by_status": "SELECT status, count(*) AS n, count(*) FILTER (WHERE updated_at > now() - interval '30 days') AS updated_last_30d FROM whatsapp_templates GROUP BY status ORDER BY status",
 "inline_sends_campaign_has_template_id": f"""SELECT count(*) AS sends_without_template_id,
     count(*) FILTER (WHERE c.whatsapp_template_id IS NOT NULL) AS campaign_now_links_a_template,
     count(*) FILTER (WHERE coalesce(c.template_zh_hk,'')<>'' OR coalesce(c.template_en,'')<>'' OR coalesce(c.template,'')<>'') AS campaign_has_inline_text
   {SENDS.replace('FROM whatsapp_messages m', 'FROM whatsapp_messages m JOIN campaigns c ON c.id = m.campaign_id AND c.restaurant_id = m.restaurant_id')}
     AND m.template_id IS NULL AND m.message_type='text'""",
 "campaigns_inline_shape": """SELECT count(*) AS campaigns, count(*) FILTER (WHERE whatsapp_template_id IS NULL) AS no_template,
     count(*) FILTER (WHERE whatsapp_template_id IS NULL AND coalesce(template_zh_hk,'')<>'') AS no_template_has_zh,
     count(*) FILTER (WHERE whatsapp_template_id IS NULL AND coalesce(template_en,'')<>'') AS no_template_has_en,
     count(*) FILTER (WHERE whatsapp_template_id IS NULL AND coalesce(template_zh_hk,'')='' AND coalesce(template_en,'')='' AND coalesce(template,'')<>'') AS no_template_legacy_only,
     count(*) FILTER (WHERE whatsapp_template_id IS NULL AND coalesce(template_zh_hk,'')='' AND coalesce(template_en,'')='' AND coalesce(template,'')='') AS no_template_no_text
   FROM campaigns""",
 "members_language": "SELECT coalesce(preferred_language,'(null)') AS preferred_language, count(*) AS n FROM members GROUP BY 1 ORDER BY 1",
 "restaurants_default_language": "SELECT default_language, count(*) AS n FROM restaurants GROUP BY 1 ORDER BY 1",
}

out = {}
for k, q in Q.items():
    out[k] = sql(q)
    print(f"## {k}\n{json.dumps(out[k], indent=1, default=str)}")
