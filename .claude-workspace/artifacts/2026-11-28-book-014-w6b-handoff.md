---
id: artifacts/2026-11-28-book-014-w6b-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-28
status: active
item: BOOK-014-W6b
state: blocked
brief: inline (team-lead dispatch, BOOK-014-W6b)
base: 7388c35df210b93b795da6cf077ecd40a63a5f6a
head: see pushed tip   # docs-only commit on top of base
branch: feature/book-014-core
pushed: true
pr: https://github.com/xavierau/omc/pull/237   # not merged
stage: poc
gate: {result: n/a, note: "no src change (docs, evidence scripts and testid registry only)"}
next: {owner: team-lead, action: "get the owner to (1) sign up for Connect in TEST mode on platform acct_1NvaUi… and (2) unblock webhook delivery (add stripecli_session_write to the restricted key, or stripe login into that account, or rule the /v1/events relay), then SendMessage book014-w6b-walk to resume"}
blockers:
  - "Stripe Connect not activated on the platform (test mode). accounts.create → invalid_request_error: \"You can only create new accounts if you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect.\" Connect Stripe in Settings → Booking answers 502 and shows 未能連接 Stripe，請再試一次。"
  - "stripe listen: the CLI is logged in to acct_1TMlchRu0TnXZMES (another business), not the key's platform acct_1NvaUiBOrstacydg; `stripe listen --api-key <rk_test>` → 403 more_permissions_required: \"Enabling Debugging Tools Write ('stripecli_session_write') permissions on this key would allow this request to continue.\""
refs: [specs/2026-11-27-book-014-booking-deposits, plans/2026-11-27-book-014-booking-deposits, artifacts/2026-11-28-book-014-w6-fix-handoff, artifacts/2026-11-27-book-014-w4-handoff, kanban:BOOK-014]
---
ac:
  AC-1: {result: blocked, evidence: "evidence/2026-11-27-book-014/walk.md: W1 blocked at Connect (expected vs observed, exact Stripe messages, permission probe table); W2-W10 not run"}
  AC-2: {result: blocked, evidence: "only w6b-blocked-connect-error-zh.png (the settings payments block with the connect error); no Checkout, /p, staff-row or refund screenshots possible"}
  AC-3: {result: n/a, evidence: "no src change. Diff vs base: .claude-workspace/ui-map/testid-registry.md (1 row edited), this handoff, evidence/2026-11-27-book-014/ (walk.md, dev-run.sh, seed-w6b.sh, seed-w6b.sql, 1 png)"}
  AC-4:
    result: partial
    evidence: "registry: booking-pay-checking, booking-pay-refund-due, booking-pay-unreadable added to the /p row; no other booking-pay-* or deposit id added since W4 is missing. The brief's git grep is NOT empty: it prints pre-existing fake fixtures only (sk_test_51FAKEkey… / sk_test_SECRET… / rk_live_SECRET / whsec_someone_else in payments tests, first in e7a7226e; whsec_5f1c… example in docs/integrations/member-api.md, from e2f9fc92). The real rk_test_ key value and the walk's whsec_ value were checked with git grep -F and are in no tracked file and not in the evidence folder."
  AC-5: {result: pass, evidence: "docs commit pushed with rtk proxy git push; ls-remote == HEAD (checked after push); no PR walk comment, since nothing was walked"}
decisions:
  - "Stopped at the first escalate_if (Connect not activated + listen 403) instead of working around them. Did not create a connected account through the API and did not use the CLI's other-account login."
  - "Interim STRIPE_WEBHOOK_SECRET: a locally generated whsec_ in the tree's gitignored .env.local (the adapter refuses to build without one). Replace it with the stripe listen secret on resume."
  - "Permission probes sent invalid params (400 parameter_unknown means permitted), so nothing was created. The one real accounts.create repeat failed (Connect not signed up), so nothing was created either."
invariants:
  - "No real Stripe object was created or changed; GET /v1/accounts on the platform is still empty."
  - "The app failed closed on the provider error: 502 provider_unavailable, and the log names only the Stripe error type (R64)."
unverified:
  - "Everything in W1-W10 (real Checkout, Connect onboarding, webhooks, refunds, the lapse/late-payment race)."
  - "Whether Stripe test-mode Standard onboarding can be completed headless (not reached)."
scope_drift: []
in_flight: []
local_env_notes:
  - "Stack whatsapp-crm-w4 (~/.cache/book014-w4-stack): 097 refreshed from this tree, db reset to 001..097, seeded (seed-w6b.sh); stopped with the volume kept. Restart: supabase start -x realtime,storage-api,imgproxy,studio,postgres-meta,edge-runtime,logflare,vector,supavisor,mailpit (in that folder). The seed survives (no reset needed)."
  - "Walk Redis: container book014-w6b-redis (127.0.0.1:56380), stopped; docker start book014-w6b-redis."
  - "App: dev-run.sh <supabase status -o env file> <tree> → next dev -p 3080. next dev regenerates AGENTS.md (removed, never committed)."
  - "The chrome-devtools MCP may save screenshots only inside its workspace roots (the main checkout); one landed there and was moved to the evidence folder right away. On resume, save then move at once, or use a scratchpad Playwright driver."
