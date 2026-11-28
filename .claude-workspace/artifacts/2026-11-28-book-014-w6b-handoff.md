---
id: artifacts/2026-11-28-book-014-w6b-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-28
status: active
item: BOOK-014-W6b
state: done
brief: inline (team-lead dispatch, BOOK-014-W6b; rulings r1 stripe login, r2 onboarded, r3 key permissions)
base: 7388c35df210b93b795da6cf077ecd40a63a5f6a
head: see pushed tip   # docs-only commits on top of base
branch: feature/book-014-core
pushed: true
pr: https://github.com/xavierau/omc/pull/237   # into develop, not merged
stage: poc
gate: {result: n/a, note: "no src change on the walk (no bug fixed: the one defect found changes the state machine, escalated)"}
next: {owner: team-lead, action: "rule on Finding A (refund failed after succeeding stays 'refunded'); then owner decides the #237 merge"}
blockers: []
refs: [specs/2026-11-27-book-014-booking-deposits, threats/2026-11-27-book-014-booking-deposits, plans/2026-11-27-book-014-booking-deposits, artifacts/2026-11-28-book-014-w6-fix-handoff, artifacts/2026-11-27-book-014-w4-handoff, kanban:BOOK-014]
---
ac:
  AC-1:
    result: pass
    evidence: "evidence/2026-11-27-book-014/walk.md: W1-W10 each with expected vs observed, DB rows (walk-state.log), Stripe session/payment intent/refund ids and statuses, diner messages (kapso-fake.jsonl, tokens scrubbed). All pass; no fix commit needed. W1's Active came from the return-page refresh (the first account.updated was not delivered); real account.updated delivery proven in W10 (evt_1UgmJtBsmWz9nN6AlVza01OW)."
  AC-2:
    result: pass
    evidence: "Screenshots in the same folder: settings Active + deposit block (zh, en); Checkout with HK$400.00 (w6b-w2-checkout-filled.png); /p paid, lapsed, held, refunded, refund pending, closed; staff rows paid, refund pending, refunded, kept, awaiting (+ all badges en); Stripe refund JSON stripe-refund-re_3UgmLQBsmWz9nN6A2hgdSksD.json. /p and the /b statements are bilingual on one page; /b and dashboard UI captured in zh-HK and en (server locale restart)."
  AC-3:
    result: n/a
    evidence: "no src change. Diff vs base: .claude-workspace (walk evidence, this handoff, testid registry 1 row), .claude/kanban.json (BOOK-014 entry)."
  AC-4:
    result: partial
    evidence: "testid-registry.md: booking-pay-checking, booking-pay-refund-due, booking-pay-unreadable added (no other new id missing). The brief's git grep is NOT empty: it prints pre-existing fake fixtures only (payments tests from e7a7226e: sk_test_51FAKEkey…, sk_test_SECRET…, rk_live_SECRET, whsec_someone_else; docs/integrations/member-api.md whsec_5f1c… example from e2f9fc92). The real rk_test_ key and the listen whsec_ were checked with grep -F: absent from tracked files and from the evidence folder. Evidence scanned for home paths, LAN IPs, key/whsec patterns, /b and /p tokens and Checkout URL fragments: none."
  AC-5:
    result: pass
    evidence: "rtk proxy git push; ls-remote == HEAD; PR #237 comment with step -> pass table and the walk log path; mergeable state in the comment check."
decisions:
  - "Browser drivers: chrome-devtools MCP for admin pages; a scratchpad Playwright driver (diner.mjs, cached Chromium, playwright-core 1.58.2) for /b, Checkout (fields in Stripe iframes) and /p."
  - "W6 race: Checkout filled and held open, then the hold lapsed with the cron's own RPC lapse_expired_booking_deposits(1, id) without the session close, then Pay. Real Stripe objects end to end."
  - "W3 refund_pending: 4242 refunds settle synchronously, so refund_pending is not observable on it; W3b used Stripe's pending-refund test card 4000000000007726 to walk refund_pending -> refunded via refund.updated. W3c used 4000000000005126 (refund fails later) and found Finding A."
  - "W7: the first staff hold's diner had no WhatsApp window and the local stack has no approved booking_deposit_request template, so link and confirmed message were not_delivered (expected; spec Copy link state). W7b repeated with a diner in the window: both texts delivered."
  - "W8 needed the AI booking tools enabled in Settings (off by default in agent_config.enabledTools) and the BullMQ worker running (worker-run.sh, as prod runs scripts/start-worker.ts)."
  - "W10: restricted the account row in the DB (brief option), then triggered a real account.updated with an API metadata update on the connected account; the webhook set the row back to active."
findings:
  - "A (needs ruling, state machine): a Stripe refund that first succeeds and later fails (refund.updated failed evt_3UgmOuBsmWz9nN6A1nIpjC1t, refund.failed evt_3UgmOuBsmWz9nN6A1mUnsEJE; re_3UgmOuBsmWz9nN6A1Zt4V8Xy expired_or_canceled_card) is dropped: finishRefund returns null for a 'refunded' deposit -> 'duplicate', no log. Deposit stays 'refunded', staff see 已退款, diner unpaid. Fix needs refunded -> refund_failed (or a log + alert at minimum); not done per escalate_if."
  - "B (FYI): Adaptive Pricing on the restaurant's Standard account makes Checkout default to the payer's IP currency (NT$ here); HK$ offered; settlement and amounts stay HKD, app unaffected."
invariants:
  - "Every Stripe event forwarded on the walk (30) answered 200; no deposit changed on a replayed or not-ours event (charge.refunded ignored while a refund was pending)."
  - "A second Refund/Keep after a decision answered 409 and Stripe kept exactly one refund."
  - "A late payment after the lapse was refunded automatically and the booking stayed lapsed."
unverified:
  - "Meta-approved booking_deposit_request template send (no template locally); W7 used the free-text path inside the 24 h window."
  - "account.application.deauthorized (not triggerable without the owner disconnecting the account in the dashboard)."
  - "The first account.updated (13:35:11Z) delivery: the first listener's output was block-buffered; the event never reached the app."
scope_drift: []
in_flight: []
local_env_notes:
  - "Stack whatsapp-crm-w4 stopped with the volume kept (now holds this walk's data); Redis container book014-w6b-redis stopped; stripe listen, next dev and the worker stopped. AGENTS.md (next dev) removed; CLAUDE.md unchanged."
  - "Tree .env.local (gitignored) holds STRIPE_SECRET_KEY (rk_test_), STRIPE_MODE=test and the CLI's listen STRIPE_WEBHOOK_SECRET."
  - "Stripe test objects left in place: connected account acct_1UgkeeBsmWz9nN6A (metadata w6b_walk=account_updated_probe) and its test payments/refunds; open paid test bookings were not refunded."
