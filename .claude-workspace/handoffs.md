# Handoff Log

| date | agent | item | status | artifact | next | blocker |
|---|---|---|---|---|---|---|
| 2026-11-21 | dev | BOOK-010 W1 | done | artifacts/2026-11-20-book-010-w1-handoff · artifacts/2026-11-20-book-010-w1-impl | main: review ea989937..74398f92, then W2 UI | none |
| 2026-11-20 | dev | BOOK-009 I-009 | done | artifacts/2026-11-20-book-009-i-handoff · tests/evidence/2026-11-20-book-009-i/walk-log | main: review PR #222; then W5 BOOK-010 from its head | none |
| 2026-11-20 | dev | BOOK-009 W2+W3 | done | artifacts/2026-11-20-book-009-w23-impl · artifacts/2026-11-20-book-009-w23-handoff | main: W4, then I-009 DB walk + PR | none |
| 2026-11-20 | dev | BOOK-009 W4 | blocked | artifacts/2026-11-20-book-009-w4-impl · artifacts/2026-11-20-book-009-w4-handoff | main: rule on 42949788; I-009 merge | NewAgentBooking terms fields outside files_allowed (own commit) — main |
| 2026-11-20 | dev | BOOK-009 W1 | blocked | artifacts/2026-11-20-book-009-w1-impl · artifacts/2026-11-20-book-009-w1-handoff | main: rule on AI tool call sites (W4?); dispatch W2/W3 + W4 | AI tools still pass maxPartySize (outside files_allowed) — main |
| 2026-11-20 | dev | AGENT-005 release | done | deploys/2026-11-20-agent-005-release-runbook · artifacts/2026-11-20-rel-agent005-handoff | main: merge records PR; owner fills omc 訂座規則 and live-checks an out-of-hours booking ask | — |
| 2026-11-20 | dev | BOOK-008 release | done | deploys/2026-11-20-book-008-release-runbook · artifacts/2026-11-20-rel-book008-handoff | main: merge records PR; owner live member-panel / relink check | — |
| 2026-11-20 | dev | BOOK-007 release | blocked | deploys/2026-11-20-book-007-release-runbook · artifacts/2026-11-20-rel-book007-handoff | main: rule on the Kapso warn line; merge records PR; owner live no-show check | AC-4 literal fail: pre-existing [Kapso] warn line — main |
| 2026-11-20 | dev | BOOK-006 release | done | deploys/2026-11-20-book-006-release-runbook · artifacts/2026-11-20-rel-book006-handoff | main: merge records PR; owner live omc check | — |
| 2026-11-20 | dev | AGENT-004 release | done | deploys/2026-11-20-agent-004-release-runbook · artifacts/2026-11-20-rel-agent004-handoff | owner live omc check | — |
