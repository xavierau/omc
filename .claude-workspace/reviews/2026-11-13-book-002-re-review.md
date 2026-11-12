---
id: reviews/2026-11-13-book-002-re-review
type: review
author: verifier
mode: re-review
created: 2026-11-13
status: active
supersedes: null
superseded_by: null
related: [artifacts/2026-11-13-book-002-f1-handoff, artifacts/2026-11-12-book-002-handoff, specs/2026-11-12-booking-template-editing, threats/2026-11-12-restaurant-booking]
---
# Code Review: BOOK-002 F1 fix round (PR #182, d24408ba..9190bde5)

## Summary
Re-review of the F1 fix round on `feature/book-002` (tree `/Users/xavierau/Code/js/whatsapp-crm-BOOK-001-worktree`, HEAD 9190bde5 = `origin/feature/book-002`). The diff covers 34 files. I read it at HEAD, not from the dev's handoff. The original `/code-review` findings C1 to C10 are not stored as an artifact or as PR comments, so each one is judged against the one-line statement in the brief. That is why `supersedes` is null.

All ten findings are closed, and so are the zh_HK reminder copy and the zh floor of 6. The new compare-and-swap path on `booking_config.rev` is correct. Every `booking_config` writer in `src/` goes through it, and grep confirms there is no other writer in `src/`, `supabase/` or `scripts/`. The legacy `is.null` guard works on rows written before rev existed. A retry re-applies only the writer's own change to a fresh read. Promotion cannot happen twice. The settings PUT still cannot write `templateIds`, `templateBodies`, `templateCandidates` or `rev`.

I re-ran the real-PostgREST CAS suite against the dev's scratch stack (v14.14 + Postgres 17.6): 5/5 pass, and in the slot-edit race 36 PATCHes went out for 24 writes, so the retry path really ran. I also re-ran `booking-template-body`, `booking-config-template-edit` and `send-booking-message-candidate`: 86/86 pass.

There are four new findings, all 🟢 Minor. None blocks the release.

### Closure table (R2-01)

| id | finding | status | evidence (HEAD) |
|---|---|---|---|
| C1 | full-width placeholders bypass the validator | **closed** | `booking-template-body.ts:122-131`: `validateBookingTemplateBody` checks `normalizeBookingTemplateBody(body)`, the same `normalizeTemplateText` the submit pipeline uses (`prepare-template-components.ts:55-62`). `edit-booking-template.ts:113-114` stores and submits the normalized text. `booking-template-editor-model.ts:81-83`: the preview uses the same normalized text. Route tests "C1:" ×3 cover this. |
| C2 | booking_config writers overwrite concurrent changes | **closed** | `booking-config-repository.ts:55-121`: all four writers (settings, provisioning, edit, promotion) call `changeBookingConfig`. It reads, applies its change, then writes with a guard on `booking_config->>rev` (or `is.null` when the row has no rev), and retries 5 times with a fresh read. Real-PostgREST suite: 5/5, re-run by me. |
| C3 | text equal to the pending candidate resubmits | **closed** | `edit-booking-template.ts:83-86,99`: `pendingCandidateWith` reuses the candidate only when it is `pending` and its stored BODY equals the normalized target. A rejected or failed candidate is resubmitted (decision 6). `changesNothing` (`:104-108`) skips the write. |
| C4 | synchronous Meta rejection shown as "not sent" | **closed** (edit path) | `booking-template-editor-model.ts:28` maps it to `{kind:'rejected', reason}`. It is in `FAILED`, so it renders as an alert (`:85`). `booking-template-language-editor.tsx:50` passes the reason, or the "none given" text. Both locales have the string (en.json:1452, zh-HK.json:1452). The reset path is listed under Open Questions. |
| C5 | bare domains and short links pass the link rule | **closed** | `booking-template-body.ts:45-55` adds a `BARE_DOMAIN` check alongside `URL_LINK`. Probed: `7.30pm`, `$1.5`, `Dr. Chan`, `Nathan Rd. St. 5`, `e.g.`, `No.5`, `a.m. p.m.`, `U.S.`, `3.5hrs` all pass. False positives appear only when a period has no space after it (N2). |
| C6 | editor opens with the default instead of the live body | **closed** | `booking-template-editor-model.ts:37-41` `editorText`: custom text, else the default while a reset waits at Meta, else `approvedBody`, else the default. The slot view carries `approvedBody` (`booking-template-statuses.ts:86`). `edit-booking-template.ts:88-98`: saving the live text with no custom text stores nothing. |
| C7 | provisioning leaves a stale failed/rejected candidate | **closed** | `provision-booking-templates.ts:89,142` and `booking-template-slot.ts:98-107`: the candidate is cleared only while it is still the stale id it saw, so a newer edit survives. |
| C8 | sender delays the send on promotion and does serial lookups | **closed** | `send-booking-message.ts:48-53`: one `findTemplates` call for the candidate and live ids of both languages. `:118-121`: the send goes first, then the awaited promotion. `:87-94`: promotion errors are swallowed. Double promotion is impossible: `applyBookingTemplatePromotion` returns null once the candidate has moved (`booking-template-slot.ts:80`), and the CAS makes only one writer win (8-way race in the suite: exactly 1 true). |
| C9 | orphaned `bookingTemplateComponents` | **closed** | `booking-templates.ts:50` now takes `(text)`. It is used by `edit-booking-template.ts:75` and `provision-booking-templates.ts:103`, and no caller of the old signature is left (grep). |
| C10 | settings GET reads config twice | **closed** | `route.ts:41-42`: one `getBookingConfig`, passed to `bookingTemplateOverviewFor(restaurantId, config)`. `booking-template-statuses.ts:107-110`: the statuses path builds no slot views. |
| copy | zh_hk reminder copy, no longer frozen | **closed** | `booking-templates.ts:41` matches the brief exactly (byte-compared), and so does the free-text fallback (`booking-message.ts:87`). `booking-templates.test.ts:135-137`: `FROZEN_BELOW_FLOOR` holds only `received/zh_hk`, and the reminder is asserted as approved copy. New copy ratio: 11.0 chars per placeholder. |
| floor | zh floor is 6 | **closed** | `booking-template-body.ts:22` sets `ZH_CHARS_PER_PLACEHOLDER = 6`. The test imports it (`booking-templates.test.ts:130,150`). The en/zh hints say 6. |

### Read-closely items
- **Rev guard.** `writeIfUnchanged` (`booking-config-repository.ts:71-81`) writes `rev+1` when the stored rev is an integer, and 1 otherwise. An integer rev is guarded by `->>rev = String(rev)`. A missing or `null` rev is guarded by `is.null`. A row with no rev takes rev 1 on its first write and then counts up (suite test 5). Rev is stamped after `change()` runs on a resolved config, which drops `rev`, so no writer can supply its own rev.
- **Retry re-applies only the writer's own change.** `change` is a closure over the writer's intent (settings fields, provisioned slots, one slot edit, one promotion), and it runs on a fresh `resolveBookingConfig(raw)` on every attempt (`:84-88`). No writer passes the whole stale blob any more. The settings PUT goes through `applyBookingSettings` (`booking-config.ts:169-172`), which copies only 5 fields. Provisioning writes only its own slots.
- **Give-up.** After 5 lost swaps the function throws `Failed to update booking config: changed concurrently`. Settings PUT and the edit route then return 500. Provisioning is caught by `templatesAfterSave` (the save itself still succeeds). The sender's promotion is logged and swallowed. See N3 for the side effect.
- **Settings PUT cannot set template fields or rev.** `parseBookingSettings` refuses any key outside the 5 settings fields (`booking-config.ts:142,178-179`). `applyBookingSettings` copies only those 5 fields, and rev is stamped by the repository. Closed in both layers.
- **Existing prod rows.** For a row like `{"mode":"off"}` with no rev, every reader goes through `resolveBookingConfig`, which ignores `rev` and defaults the rest, so nothing changes. The first write matches `is.null` and stores the full resolved config with `rev: 1`. That passes the 082 CHECK (an object, mode in the allowed list).
- **Tenant scoping.** Every read and write carries `.eq('id', restaurantId)`. `restaurantId` comes from the session (`route.ts`, `templates/route.ts`) or from the server-side booking input (sender). The template lookup is `findManyByIdsForRestaurant`, scoped by `restaurant_id` (`whatsapp-template-repository.ts:64-79`).
- **C5 false positives.** See N2. Every case the brief names passes.
- **C8 double promotion.** Not possible, see the C8 row.

## 🔴 Critical (Must Fix)
None.

## 🟡 Important (Should Fix)
None.

## 🟢 Minor (Optional)

**N1. Taking back a pending reset by typing the live custom text leaves the custom text unset.** `edit-booking-template.ts:89-91,98`.
- Scenario: custom text X is approved and live. The admin resets, so the stored text is cleared and a default-copy candidate goes pending. The editor then opens with the default (C6 rule). The admin types X back. `approvedBodyOf === target`, so the edit has `body: bodyForLiveText(X, stored=null) = null` and `candidateId: null`. The slot ends up live = X while `templateBodies` says "default copy".
- Risk: if the live X template later stops being sendable (paused or disabled), provisioning resubmits the default copy (`provision-booking-templates.ts:88`), and the free-text fallback sends the default copy (`send-booking-message.ts:105-108`), not X. Decision 4 accepts this ("keeps the custom text unset when it was unset"), but here the text was unset only because of the reset being taken back.
- How to show it fails: in the edit route test, store `templateBodies.confirmed.en = undefined`, a pending default candidate, and live `tpl-old` approved with NEW_BODY. Then `edit(NEW_BODY)` leaves `stored.templateBodies.confirmed.en` undefined.
- Fix (optional): treat "stored null with a candidate in the slot" as a reset in flight. In that case keep `body` instead of nulling it.

**N2. The C5 rule refuses ordinary copy that has no space after a period when the next word is in the TLD list.** `booking-template-body.ts:51-55`.
- Probed with the HEAD regex. These are refused with the `link` error: `See you at 7pm.To cancel, reply here.` (`7pm.To`), `G/F.Shop 12` (`F.Shop`), `We are at Tsim Sha Tsui.Top floor`, `in Hong Kong.Info: reply`, `Kowloon.Me`, `Party of 4.Us too`.
- Risk: the save is blocked with a "remove the link" message the admin cannot match to anything in the text. It is low frequency, and adding a space works around it.
- Also not caught (accepted by decision 3): full-width dot `kushiro．hk`, TLDs not on the list (`menu.restaurant`).
- Fix (optional): match the TLD case-sensitively in lower case, or skip a match when the character after the last dot is upper case and no `/` or `@` is involved.
- How to show it fails: `validateBookingTemplateBody('reminder','en','See you at {{time}} on {{date}} at {{restaurant}}.Thanks, 7pm.To cancel reply here')` returns a `link` error.

**N3. Giving up the CAS after the Meta call has been made orphans templates.** `booking-config-repository.ts:83-91`, `edit-booking-template.ts:99,119` and `provision-booking-templates.ts:138,144`.
- Scenario: the edit creates candidate D at Meta, then `saveTemplateEdit` loses 5 swaps in a row and throws. The route returns 500, D is never recorded, and the next save creates another candidate. Provisioning has the same pattern.
- A missing restaurant row also ends in the same throw. Its message, "changed concurrently", is wrong for that case, because a 0-row update is read as a lost race.
- Probability is very low: 5 losses in a row needs 5 or more writers to the same restaurant at the same moment, and promotion losers stop on null instead of retrying. The orphan cost already existed for any DB error.
- Fix (optional): in `writeIfUnchanged`, tell a missing row apart from a changed rev (if the re-read returns null, throw "not found"). Log the orphaned template id when the save after a Meta call throws.

**N4. Manual SQL edits to `booking_config` that do not bump `rev` are not protected.**
- An operator `jsonb_set` (for example toggling `aiRoutingEnabled`) that lands between a writer's read and its write is overwritten, because the guard only sees `rev`.
- Fix (optional): note in the ops runbook that manual edits must also set `rev = rev + 1`. Alternatively, a later migration could add a trigger that bumps it.

## ✅ Strengths
- The CAS has a 26-byte guard, needs no migration, and was proven on real PostgREST with races that actually lost and retried (36 PATCHes for 24 writes). It was red at base, per the handoff `red.log`.
- Each writer's change is a pure domain function (`applyBookingSettings`, `applyProvisionedTemplates`, `applyBookingTemplateEdit`, `applyBookingTemplatePromotion`). The repository stays a thin CAS loop. Each function is unit-tested on its own.
- The promotion check doubles as the CAS no-op (it returns null), so it can never promote twice. Concurrent promotions that lose stop rather than retry.
- C7 clears a candidate only while it is still the stale id provisioning saw, so a newer edit written meanwhile survives.
- The validator, storage, submission and preview all use one normalization function (C1). Previously each had its own.

## Open Questions
- **C4 on the reset path.** `savedOutcome` returns `reset` before it looks at the candidate (`booking-template-editor-model.ts:25`). A reset whose default-copy candidate is rejected or failed at submission still shows "Default restored." This behaviour predates the round and is unlikely for owner-approved default copy. Should a rejected or failed reset candidate show `rejected` / `not_sent` instead?
- **Prod PostgREST version.** The `booking_config->>rev=is.null` / `eq.<n>` filters were proven on PostgREST v14.14. Hosted Supabase prod runs whatever version the project has (unconfirmed — looked in: handoff `unverified`, no prod probe). JSON-path filters predate v10, so the risk is low, but the first prod settings save is the real check.
- **Prod gateway URL limit.** It was the reason whole-value CAS was rejected. It does not matter now that the guard is the rev.
- **INDEX.md entry not written.** `files_allowed` names only this file, so the INDEX line is left to the main thread.

## Verdict: APPROVED
Brief vocabulary: **APPROVE**. C1 to C10, the zh_HK reminder copy and the zh floor of 6 are all closed. The CAS writer path adds no 🔴 or 🟡 defect. N1 to N4 are optional.

## Next Steps
- Owner's release decision on PR #182.
- Optional follow-ups, any order: N2 (case-sensitive TLD match), N1 (keep the custom text when a reset is taken back), N3 (tell a missing row apart from a lost race, log orphaned template ids), N4 (runbook line).
- After release, the first Simple save resubmits the rejected zh reminder with the 2026-11-13 copy. Watch for Meta's verdict on it.
- Scratch stack still running: `docker rm -f b2f1-rest b2f1-db && docker network rm b2f1-net`.
