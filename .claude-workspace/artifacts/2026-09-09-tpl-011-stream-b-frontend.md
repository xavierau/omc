---
id: artifacts/2026-09-09-tpl-011-stream-b-frontend
type: artifact
author: react-frontend-dev
created: 2026-09-09
status: final
related: [kanban:TPL-011, plans/2026-09-09-tpl-011-video-template-header]
---

# TPL-011 Stream B — VIDEO header form support (frontend)

## Files Changed

| File | Lines | Purpose |
|---|---|---|
| `src/components/dashboard/wa-template-form-types.ts` | ~+25/-6 | `headerType` gains `'video'`; `headerImageUrl → headerMediaUrl` rename; `extractImageUrl → extractMediaUrl`; VIDEO round-trip in `templateToFormState`/`buildWaTemplateRequestBody`; new `applyWaTemplateFormChange` |
| `src/components/dashboard/video-uploader-helpers.ts` | new, 51 | Pure helpers: `videoFileError`, `readUploadResponse`, `VIDEO_ACCEPT` |
| `src/components/dashboard/video-uploader.tsx` | new, 97 | Sibling to `ImageUploader`; `<video preload muted controls>` preview |
| `src/components/dashboard/wa-template-form-fields.tsx` | +18 | `HeaderSection`: Video `<option>`, `VideoUploader` bound to `headerMediaUrl`, `videoHeaderHint` under `data-testid="video-header-hint"`; image branch re-bound to `headerMediaUrl` |
| `src/components/dashboard/wa-template-form-dialog.tsx` | ~+2/-1 | `handleChange` delegates to `applyWaTemplateFormChange` |
| `src/messages/en.json`, `src/messages/zh-HK.json` | +1 each | `waTemplates.videoHeaderHint` added next to `imageHeaderHint` |
| `src/components/dashboard/__tests__/wa-template-form-types.test.ts` | +~200 | Header mapping, header component build, round-trip property, `applyWaTemplateFormChange` |
| `src/components/dashboard/__tests__/video-uploader-helpers.test.ts` | new | `videoFileError`, `readUploadResponse`, `VIDEO_ACCEPT` |
| `src/components/dashboard/__tests__/wa-template-form-fields.test.tsx` | +~40 | Video hint / no-hint per header type, Video `<option>` present |
| `src/messages/__tests__/wa-templates-i18n-keys.test.ts` | new | Key-pins `imageHeaderHint` + `videoHeaderHint` in both locales |

## Components

- **Reused**: `Button`, `Input` (unchanged imports).
- **New**: `VideoUploader` (`src/components/dashboard/video-uploader.tsx`) — sibling to `ImageUploader` per plan decision 2, not a parameterised variant. Same props (`bucket, currentUrl, onUploaded, onRemoved?, className?`), same `common.generate/regenerate/loading` labels, 80×80 frame. Location: `/components/dashboard/` alongside `image-uploader.tsx` (feature-adjacent, matches existing pattern — this codebase doesn't use the `/ui//patterns//features/` split described in agent defaults).
- **Untouched**: `ImageUploader` and its four callers (`welcome-image-fields.tsx`, `campaign-image-uploader.tsx`, `tenant-logo-section.tsx`, `wa-template-form-fields.tsx` image branch) — confirmed via `git diff --stat` showing 0 changes to the first three.

## Hooks & State

No new hooks/stores. Form state stays local `useState` in `WaTemplateFormDialog`, now routed through the pure `applyWaTemplateFormChange(form, key, value)` (mirrors `applyTemplateButtonChange`) instead of a bare object spread, so a header-type change clears the stale media URL.

## Key Decisions

- **No deviation from the plan.** Implemented exactly B-1 through B-5 as specified, including the two "two additions the image path lacks" in decision 2 (client size pre-check, non-JSON-tolerant response reader), both in the pure helpers file.
- `readUploadResponse` reads the response body as `text()` first, then `JSON.parse`s it in a try/catch, rather than calling `res.json()` directly — this is what makes a 413 HTML page produce `"File is too large for the server to accept..."` instead of an `Unexpected token` parse error.
- `applyWaTemplateFormChange` takes `value: unknown` (matching the dialog's existing `OnChange` signature) and casts internally; a same-type reselect (`video → video`) is a no-op on `headerMediaUrl` per the frozen test.

## Tests

- `wa-template-form-types.test.ts`: 44 → added header-mapping (3), header-component-build (3), round-trip property (2, `it.each`), `applyWaTemplateFormChange` (5) = **13 new tests**, all pre-existing 44 kept.
- `video-uploader-helpers.test.ts`: **9 new tests** (new file).
- `wa-template-form-fields.test.tsx`: 6 pre-existing kept + **4 new** (video hint, 3× no-video-hint, Video option present — 5 new, see file for exact count).
- `wa-templates-i18n-keys.test.ts`: **3 new tests** (new file).
- No domain-layer tests in this stream (pure UI/form-state work).

## B-0 Red Run (frozen suite, before implementation)

Committed as `f71dfb3` (this commit also unintentionally swept in Stream A's then-staged A-0 files — see Deferred/Tech Debt below; content of both is correct, only attribution is mixed). Confirmed red:

```
 Test Files  4 failed (4)
      Tests  16 failed | 39 passed (55)
```

One suite (`video-uploader-helpers.test.ts`) failed to load entirely (`Cannot find module '../video-uploader-helpers'`); the other three failed on the not-yet-implemented `'video'` headerType, `headerMediaUrl` field, and `applyWaTemplateFormChange`/`videoHeaderHint` key.

**Suite was not weakened or changed after freezing.** Implementation (commit `d05af9b`) was written to satisfy the frozen assertions as-is; no test was edited, skipped, or deleted between B-0 and the final green run.

## Final Verification

- `npx tsc --noEmit`: clean (one fix needed mid-implementation: `applyWaTemplateFormChange`'s same-type branch needed an explicit cast from `unknown` to the `headerType` union — not a scope change, just satisfying the compiler).
- `npx eslint` on all touched files: clean, **except one pre-existing error** in `wa-template-form-dialog.tsx:35` (`react-hooks/set-state-in-effect` on the pre-existing `useEffect` that calls `setForm`) — confirmed via `git stash` + re-lint that this error exists identically on the file before my change (same rule, same line content, shifted by one line from my added import). Out of scope per Surgical Changes; not fixed.
- `npm test` (full suite, run twice): **4417 passed, 21 skipped, 2 todo, 0 failed** both times. The known WAQ webhook flake did not reproduce in either run.
- `grep -rn headerImageUrl src`: no matches.
- Other three `ImageUploader` callers: byte-for-byte unchanged (`git diff --stat` shows 0 for all three).
- Send path untouched: no diff under `template-client.ts`, `template-media-header.ts`, or any `send-template-message.ts`.
- `locale-parity.test.ts`: green.

## Visual Verification Hand-off

**URL**: Dashboard → WhatsApp Templates → New (or Edit an existing template) → Header dropdown → **Video**.

**Entry path**: Sign in → left nav → WhatsApp Templates (existing page, no nav change needed — confirmed in the plan's Integration Map item 15) → "New Template" button opens the same `WaTemplateFormDialog` sheet → Header section's `<select>` now offers a fourth option, **Video**.

**Flows to verify**:
1. Header = Video → uploader + hint appear (no image hint), hint text mentions MP4/3GP/16MB.
2. Pick an oversized (>16MB) or wrong-mime file → client-side rejection message shown instantly, no network request (can confirm via Network tab).
3. Upload a valid small `.mp4` → preview `<video>` element appears with controls.
4. Submit → (depends on Stream A's route + Kapso adapter being live and, per plan R4, on DEV Supabase having migration 055 for `wa-template-media` — **not verified in this stream**, flagged for I-1).
5. Reopen the same template → Video pre-selected, same URL/preview.
6. Switch Header from Video to Image (or None) → `VideoUploader`/preview disappears, and reselecting Video (or reopening) shows an empty uploader — URL was cleared.

**Note for I-1/ui-test-runner**: per plan R4, DEV Supabase is ~30 migrations behind and may not have the `wa-template-media` bucket; if so, only the form-level legs (1, 2, 3, 6) are browser-verifiable, and legs 4/5 (actual upload + submit round-trip) rely on the route/form test coverage above plus I-2 prod verification. This stream did not run a browser check — that is I-1's job, owned by the integration pass after both streams land.

## Deferred / Tech Debt

- **Commit `f71dfb3` coordination note**: staging with `git add <my files>` followed by a bare `git commit -m` committed the *entire* index at that moment, which included Stream A's then-staged (not-yet-committed) A-0 files. Nothing was lost — content is correct — but attribution is mixed into a "Stream B" commit message. Flagged to `dev-a-tpl-011` via SendMessage at the time it happened. All commits after that point (`d05af9b`) were scoped with an explicit `git commit -- <pathspec>` to prevent recurrence.
- Third copy of the ~12-line upload-fetch pattern now exists (`ImageUploader`, `CampaignImageUploader`, `VideoUploader`) — noted as a follow-up in the plan itself (decision 2), not addressed here.
- Pre-existing `react-hooks/set-state-in-effect` lint error in `wa-template-form-dialog.tsx:35` — pre-existing, out of scope, confirmed via stash-diff above.
- I-1 (wiring walk + browser verification) and I-2 (prod post-deploy verify) are explicitly out of this stream's scope per the plan.
