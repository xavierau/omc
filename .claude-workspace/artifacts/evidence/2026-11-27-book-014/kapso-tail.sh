#!/bin/sh
# print outbound WhatsApp messages the fake recorded since line $1 (to, type, text / template params)
F=${KAPSO_LOG:-$(dirname "$0")/kapso-fake.jsonl}
tail -n +"${1:-1}" "$F" | python3 -c '
import json,sys
for l in sys.stdin:
  r=json.loads(l); b=r.get("body") or {}
  if not isinstance(b,dict) or "to" not in b: continue
  t=b.get("type"); txt=(b.get("text") or {}).get("body") if t=="text" else None
  if t=="interactive": i=b["interactive"]; txt=json.dumps({"body":i.get("body",{}).get("text"),"action":i.get("action")},ensure_ascii=False)
  if t=="template": txt=json.dumps(b["template"],ensure_ascii=False)
  print(r["at"], b["to"], t, txt)'
