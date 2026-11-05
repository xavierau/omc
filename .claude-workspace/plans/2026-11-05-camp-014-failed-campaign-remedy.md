---
id: plans/2026-11-05-camp-014-failed-campaign-remedy
type: plan
author: main
created: 2026-11-05
status: active
related: [investigations/2026-11-05-bicho-campaign-131042-wrong-reason, kanban:CAMP-014]
---

# CAMP-014: failed-campaign reason, re-run, and QR visibility

Stage: POC. Branch `fix/camp-014-failed-campaign-remedy` from `origin/develop` (same `src` as main). No migration.

1. **Reason:** `deliveryFailureReason` takes Meta's detail and picks fixed wording per cause. Both callers pass it: `reconcileCampaignSendFailure` and `failRunRetractedByMeta`.
2. **131047 wording:** a template change needs a new campaign, because failed cards cannot be edited.
3. **Re-run:** new tenant-scoped `POST /api/dashboard/campaigns/[id]/rerun`. Same gates as `/execute`, then compare-and-set `failed → active` clearing the reason, then enqueue.
4. **Refuse re-run** when delivery is unknown ("contact support" reason). That case can double-send.
5. **Card:** re-run action with confirmation on failed cards.
6. **QR-only warning:** one pure domain rule; shown in the campaign form and on the card. Warn, never block.
7. **QR failure count:** per-campaign exact count on the list API, degrading off on error. Card warns when the campaign has counted sends.
8. **Upload failures:** QR upload moves inside the tracked send, so a failed upload also leaves a failed row.
9. **Billing unchanged:** a delivered template with a failed QR stays counted.

Wiring: list API enrichment, `use-campaigns` type, `CampaignSection` props, `en.json` + `zh-HK.json`, test ids in the registry.

Review: `verifier`, then `/code-review` (re-send path). Release: develop → main → `scripts/release.sh` from a worktree.
