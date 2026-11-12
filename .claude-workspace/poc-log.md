# POC log

date · slice · question · where it shipped · outcome

- 2026-10-07 · members table paging/No-tag/contact quality + reachability restore (MEM-001 + MEM-004, PR #172, release 0071fa3) · question: do owners use quality/No-tag to clean lists · shipped prod (deploys/2026-10-07-mem-001-004-release-runbook) · outcome: pending
- 2026-11-05 · failed-campaign true reason, guarded re-run, QR failure visibility (CAMP-014, PR #176/#177, release b0b4ef0) · question: do tenants act on the true reason and re-run safely once Meta billing clears · shipped prod (deploys/2026-11-05-camp-014-release-runbook) · outcome: pending
- 2026-11-12 · BOOK-001 restaurant booking (Simple/External modes, Book now campaigns, free-text + BOOK routing, staff confirm/decline, reminder/retention crons) · Will HK restaurants switch on booking, and do diners finish the booking page from a campaign tap or a chat reply? · PR feature/book-001 → develop (not deployed; walked end to end on a local Supabase stack with 082) · 
