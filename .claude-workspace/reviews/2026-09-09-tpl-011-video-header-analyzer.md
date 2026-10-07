---
id: reviews/2026-09-09-tpl-011-video-header-analyzer
type: review
author: code-review-analyzer
created: 2026-09-09
status: active
supersedes: null
superseded_by: null
related: [kanban:TPL-011, plans/2026-09-09-tpl-011-video-template-header, artifacts/2026-09-09-tpl-011-stream-a-backend, artifacts/2026-09-09-tpl-011-stream-b-frontend, deploys/2026-09-09-tpl-011-video-upload-body-limit]
---

# Code Review: TPL-011 — VIDEO template header (`feature/tpl-011`, HEAD `1fa9012`)

Scope reviewed: `git diff origin/develop..HEAD -- src` (25 source/test files, +932/-43).
Worktree `/Users/xavierau/Code/js/whatsapp-crm-tpl-011-worktree`.
Gate-covered dimensions (types, lint, size, complexity, dead code) were **not** re-checked —
the orchestrator's gate run is taken as given.

## Summary

The change set is small, well-bounded and matches the plan closely. The per-bucket policy
module is the right abstraction and gets the one subtlety right that the plan flagged (image
check first, so the 16 MB video allowance cannot leak onto an image on `wa-template-media`).
The send path is byte-for-byte untouched, CAMP-007's invariants still hold for a stored
`.mp4` URL, and the frozen suites are provably unmodified after the freeze commit.

No CRITICAL findings. Two IMPORTANT items: one user-facing message that states the opposite
of what the code does, and one release-gating set of unverified preconditions (Kapso video
ingest is still unproven — the A-6 probe was inconclusive, not green). Verdict is
**CONDITIONAL**: mergeable, not markable done until I-2 runs.

### Answers to the specific review questions

1. **Can a video reach `campaign-images` / `tenant-assets`?** No. `checkUploadPolicy`
   (`upload-policy.ts:35`) admits `VIDEO_TYPES` only when `bucket === 'wa-template-media'`;
   every other bucket falls through to the image-only allow-list message. Pinned by
   `upload-policy.test.ts:45-55` and by the route test at `route.test.ts:76`.
2. **Can an image on `wa-template-media` exceed 5 MB?** No. The `IMAGE_TYPES` branch
   (`upload-policy.ts:31`) is evaluated before the bucket-specific video branch and is
   bucket-independent, so an `image/jpeg` at 5 MB + 1 is rejected with `File exceeds 5MB
   limit.` regardless of bucket. Pinned by `upload-policy.test.ts:66`.
3. **Is `file.type` the right trust boundary?** It is the *same* boundary the image path has
   used since the route was written, and this diff neither widens nor narrows it. `file.size`
   is the real byte count (a `File` from `formData()`, not a client claim), so the size cap is
   sound. The MIME is client-declared, which means an authenticated tenant can store arbitrary
   bytes labelled `video/mp4` — but the declared type is also what Supabase serves the object
   as, and `video/mp4` is not a script-executing content type, so there is **no new stored-XSS
   or content-type-confusion vector** relative to the image path. **No new SSRF**: the URL
   handed to Kapso is always server-derived from `getPublicUrl`, and `invalidSourceUrl`
   (`template-media-upload.ts:74-95`) still pins https + no credentials + the Supabase host.
   The one genuine delta is storage/abuse amplification (5 MB → 16 MB on one bucket) —
   see 🟢-5 and 🟡-2.
4. **Regression for the three existing upload callers?** None found. `ALLOWED_TYPES` /
   `MAX_FILE_SIZE` were replaced with a call that reproduces their exact semantics and exact
   message strings; `welcome-image-fields.tsx`, `campaign-image-uploader.tsx` and
   `tenant-logo-section.tsx` have zero diff; `normalizeExt` only gained a `3gpp` arm that no
   image mime can reach.

## 🔴 Critical (Must Fix)

None.

## 🟡 Important (Should Fix)

### 🟡-1 The video pre-check tells the operator that JPEG/PNG/WebP are allowed, then rejects them
**File**: `src/components/dashboard/video-uploader-helpers.ts:25-27`

```ts
if (!VIDEO_TYPES.includes(file.type as (typeof VIDEO_TYPES)[number])) {
  return `Invalid file type: ${file.type}. Allowed: JPEG, PNG, WebP, MP4, 3GP.`
}
```

**Problem**: the helper rejects everything outside `video/mp4|video/3gpp`, but the message it
returns lists the *bucket's* allow-list, which includes three image types it will never
accept. An operator who picks a `.png` is told "Allowed: JPEG, PNG, WebP, MP4, 3GP" while the
file is being refused — the message states the opposite of the behaviour.

**Reachable**: yes. `accept="video/mp4,video/3gpp"` (`video-uploader.tsx:94`) is a picker
*filter*, not enforcement — macOS and Windows both let the user switch to "All Files" — and it
is bypassed entirely by a paste/drop into the input on browsers that support it.

**Risk**: support noise and a dead-end for the operator (they will retry the same PNG). Not a
security or data issue.

**Note**: this exact string is prescribed by plan decision 2 / the B-0 acceptance bullet
("the same 'Invalid file type' message the server uses for this bucket"), and the frozen test
`video-uploader-helpers.test.ts:19-23` pins it. So this is a plan defect faithfully
implemented, not dev drift — fixing it means amending the plan bullet and that one assertion,
which is a post-freeze test edit and needs the orchestrator's sign-off.

**Fix**: `Invalid file type: ${file.type}. Allowed: MP4, 3GP.` — the video slot's own
allow-list. The server keeps its bucket-wide message; the two need not be identical because
they answer different questions ("can this bucket take it" vs "can this header take it").

### 🟡-2 Three release preconditions are still open; the central one (Kapso video ingest) is unproven
**Files**: none — plan R1/R5 + `deploys/2026-09-09-tpl-011-video-upload-body-limit`

- **Kapso video ingest (Integration Map row 13, plan R1)**: the A-6 probe returned
  `upload_failed / Kapso media ingest failed (404): {"error":"WhatsApp configuration not
  found"}` — the known TPL-004-era dev-key 404, i.e. **inconclusive**, not green. Whether
  Kapso's `delivery: 'meta_resumable_asset'` accepts `video/mp4` at all is still unknown. If
  it does not, every video-header submit fails in prod. Degradation is graceful (clean
  `provider_error`, row stays draft, operator sees Kapso's message), which is why this is not
  CRITICAL — but the work item must not be marked done on green tests alone. **I-2 on the prod
  test tenant is mandatory** and is the only place contract 2 is proven.
- **Supabase project global storage limit ≥ 16 MB**: unchecked in the devops artifact's
  pre-flight list (expected 50 MB, unverified). If it is below 16 MB the upload surfaces as a
  500 with a raw Supabase message rather than the route's clean 400.
- **Prod memory headroom**: the route buffers the whole body (`request.formData()` then
  `file.arrayBuffer()` → `Buffer.from`), ≈2–3× the file size transiently, so ~50 MB per
  in-flight 16 MB upload against **878 MB available** on a 17-site e2-medium box (see memory
  `incident_prod_vm_too_small_for_next_build`). Legitimate traffic on this bucket now moves
  ~3.2× more bytes per upload than before. The plan's perf budget covers server *time*, not
  concurrent memory. Acceptable at dashboard concurrency; record it, do not batch uploads.

**Good news**: nginx needs no change — the devops artifact verified a 20M http-level
`client_max_body_size` empirically (16 MB → 401 at auth, 21 MB → 413), so plan R5 is closed.

**Fix**: gate the acceptance check on I-2 + the Supabase project limit; carry the memory note
into the release runbook.

## 🟢 Minor (Optional)

**🟢-1 `mimeFromUrl` falls back to `image/jpeg` — now a worse failure mode than before**
`src/infrastructure/kapso/template-media-upload.ts:118-121`. With only images in scope, an
unmapped extension guessing jpeg was harmless. With video in scope, an unmapped extension on a
video header sends Kapso a *confidently wrong* mime, producing an opaque Meta-side rejection
instead of a local, actionable error. Reachability is low (the dashboard cannot produce an
unmapped ext for this bucket now that `3gpp → 3gp` is mapped), and the fallback is
deliberately pinned by `template-media-upload.test.ts` — so this is a judgment note, not a
defect. Consider returning `failed('fetch_failed', 'unsupported header media extension')`
instead; every extension a real row can hold today is already in `MIME_BY_EXT`, so the change
is behaviour-preserving for existing data.

**🟢-2 Nothing ties a header's `format` to the media it points at**
A hand-crafted API request can pair `format:'VIDEO'` with a `.png` URL (or the reverse); the
form can no longer produce it thanks to `applyWaTemplateFormChange`, but the server never
checks. Result is a Meta template rejection with a confusing reason, surfaced days later via
TPL-009 status sync. A one-line consistency check in `validateTemplateComponents` (extension
family must match `format`) would turn it into a save-time message. Out of this diff's scope.

**🟢-3 Six stale image-only comments remain on the media submit path**
`create-whatsapp-template.ts:57,100`, `update-whatsapp-template.ts:82,85`,
`resubmit/route.ts:58,59` still say "image URL" / "header-image handles" about code that now
mints video handles too. The plan named three *user-facing string* sites (all correctly
neutralised, plus two docstrings the dev neutralised in files they were already editing).
These six live in files this diff does not touch — **mention, do not refactor**, per Surgical
Changes. Worth a follow-up line so the next reader is not misled.

**🟢-4 `readUploadResponse` swallows a 200 with no `url`**
`video-uploader-helpers.ts:57` returns `{ url: data.url ?? '' }`, so a malformed 200 calls
`onUploaded('')` and the operator sees the uploader silently reset with no error. Throwing on
an empty url would be one line. Same class: a 200 with an empty body throws
`Upload failed (200). Please try again.` — odd text, harmless.

**🟢-5 Header-type switch and remove orphan the uploaded object**
`applyWaTemplateFormChange` clears `headerMediaUrl` but nothing deletes the object from the
public `wa-template-media` bucket. Pre-existing for images; now at 16 MB per orphan. No
lifecycle policy on the bucket. Not this diff's job — worth a backlog line.

**🟢-6 `mimeFromUrl` ignores a URL fragment**
`'…/h.mp4#x'.split('?')[0].split('.').pop()` → `mp4#x` → unmapped → jpeg. Supabase public
URLs carry no fragment; pre-existing for images. Noted for completeness only.

**🟢-7 Third copy of the ~12-line upload fetch** (`ImageUploader`, `CampaignImageUploader`,
`VideoUploader`). Already logged as an explicit out-of-scope follow-up in plan decision 2 and
both handoffs — repeating here only so it stays on the list.

## ✅ Strengths

- **`upload-policy.ts` gets the hard part right.** Checking `IMAGE_TYPES` before the
  bucket-scoped video branch is what makes "the video limit does not leak onto images" true by
  construction rather than by an extra guard, and the exact-boundary tests (5 MB and 16 MB
  accepted, +1 byte rejected) pin the `size > limit` semantics the plan specified.
- **`applyWaTemplateFormChange` fixes a real latent bug**, not a hypothetical one: the old
  generic spread would have carried an `.mp4` URL under `headerType:'image'` straight to Meta.
  The helper is pure, non-mutating (tested), and mirrors the existing
  `applyTemplateButtonChange` precedent instead of inventing a new pattern. I confirmed the
  new helper drops **nothing** the old spread did — for every key other than `headerType` it
  is the identical expression, and a same-value `headerType` set still returns a fresh object
  so re-render behaviour is unchanged.
- **Media-neutral wording without touching the error contract.** `provider_not_configured` /
  `provider_error` codes are unchanged (verified in `mapMediaHandleError` and its three new
  tests); only human strings moved. The `template-media-upload.test.ts` assertion that the
  three `invalidSourceUrl` rejections no longer match `/image/i` *and* do match `/media/i` is
  the right shape of test for a wording change.
- **CAMP-007 send-path invariants verified intact.** `git diff` on
  `send-template-message.ts`, `template-client.ts`, `template-media-header.ts`,
  `validate-template-components.ts`, `prepare-template-components.ts` is **empty**.
  `readHeaderLink` accepts any `http(s)` value, so a stored `.mp4` public URL resolves;
  `buildHeaderParams` (`send-template-message.ts:70-71`) already emits
  `{type:'video', video:{link}}`; `TemplateHeaderParam` in `domain/ports/whatsapp-templates.ts:12`
  carries the variant. `enforceHeaderMedia` is format-agnostic via `isMediaHeader`.
- **Submit ordering is safe for the new format.** All three submit paths run
  `resolveHeaderMedia` *before* `validateTemplateComponents`
  (`create-whatsapp-template.ts:104/112`, `update-whatsapp-template.ts:87/92`,
  `resubmit/route.ts:60/66`), so a fresh video URL is minted before the `4:` gate sees it — and
  an empty `header_handle: ['']` from a type-switch-then-submit is caught by that gate with a
  readable message rather than reaching Meta.
- **Honest handoffs.** The Stream A artifact discloses the inconclusive probe verbatim, the
  commit-attribution mix-up, and the one interpretive judgment call it made while authoring
  A-0 (the `enforce-header-media` substring-vs-intent reading). That call is correct: the
  plan's own decision 4 wording contains the substring "header image", so the literal reading
  of the acceptance bullet was self-contradictory and the intent reading is the only coherent
  one. No objection.

## Frozen-suite check (AC8)

**PASS — no assertion weakened or deleted after the freeze.**

- `git diff f71dfb3..HEAD -- '*__tests__*'` is **empty**. All 12 test files landed in the
  freeze commit `f71dfb3`; the four later commits (`12f35b4`, `d05af9b`, and the three
  workspace/doc commits) touch **zero** test files.
- Total deletions across `origin/develop..HEAD` in test files: **3 lines** —
  `resubmit/__tests__/route.test.ts` and `create-whatsapp-template.test.ts` each swapping
  `'Image upload is not configured'` → `'Media upload is not configured'` (the two the plan
  names, and only those), plus one `import` line in `resolve-header-media.test.ts` replaced by
  a wider import of the same module. No `it.skip`, no `.only`, no removed case.
- Caveat, informational: `f71dfb3` is titled "Stream B" but contains both streams' frozen
  tests (a bare `git commit` swept the shared index — disclosed in both handoffs). Content is
  correct; commit-message authorship in this branch is not a reliable stream attribution.

## Absence pass — Integration Map rows 1–15

| # | Wiring point | Status | Evidence |
|---|---|---|---|
| 1 | `Video` option in the header select | ✅ | `wa-template-form-fields.tsx:79` |
| 2 | `headerType` union + `headerMediaUrl` | ✅ | `wa-template-form-types.ts:84,86,94` |
| 3 | Stored VIDEO → form state | ✅ | `wa-template-form-types.ts:123` |
| 4 | Form state → VIDEO component | ✅ | `wa-template-form-types.ts:173-178` |
| 5 | Type switch clears the URL + dialog delegates | ✅ | `wa-template-form-types.ts:105-114`; `wa-template-form-dialog.tsx:52` |
| 6 | VideoUploader, `accept`, `<video>` preview | ✅ | `video-uploader.tsx:62-68,94` |
| 7 | `videoHeaderHint` in both locales + key pin | ✅ | `en.json:843`, `zh-HK.json:843`, `wa-templates-i18n-keys.test.ts` |
| 8 | Per-bucket policy table | ✅ | `upload-policy.ts:10-16,35` |
| 9 | Route uses the policy | ✅ | `route.ts:30-33` (inline checks removed) |
| 10 | `normalizeExt` `3gpp → 3gp` | ✅ | `upload-path.ts:76` |
| 11 | `MIME_BY_EXT` `mp4`/`3gp` | ✅ | `template-media-upload.ts:114-115` |
| 12 | Media-neutral strings, 3 named sites | ✅ | `template-media-upload.ts:79,81,82,92`; `resolve-header-media.ts:82,85`; `enforce-header-media.ts:20` (+2 docstrings; 6 further comments left stale — 🟢-3) |
| 13 | Kapso accepts `video/mp4` ingest | ❌ **UNVERIFIED** | A-6 probe inconclusive (dev-key 404). I-2 mandatory — 🟡-2 |
| 14 | nginx `client_max_body_size` ≥ 16 MB | ✅ | `deploys/2026-09-09-tpl-011-video-upload-body-limit`: 20M http-level, probed 16 MB→401 / 21 MB→413. No change needed |
| 15 | No DI / permission / nav / route / flag change | ✅ | grep of `'IMAGE'` and `header_handle` in non-test `src` hits only the six files this diff already covers; no other header-media render surface exists |

Rows 1–12 and 14–15 are wired and reachable from the app entry point at the code level. Row 13
is the only gap and it is a runtime/provider question, not missing wiring.
Note: the deploys artifact lives in the **main checkout's** `.claude-workspace/deploys/`, not
this worktree's — worth syncing before the release so the runbook can reference it by id.

## Open Questions

1. **Does Kapso's `meta_resumable_asset` delivery accept `video/*` at all?** Unanswerable
   without I-2 or a Kapso support answer. If I-2 returns a 4xx naming the mime or the delivery
   value, plan R1's fallback order applies and the feature ships inert (upload + form work
   land, submit surfaces `provider_error`).
2. **🟡-1 requires a post-freeze test edit.** Amending `videoFileError`'s message means
   changing one frozen assertion. Orchestrator call: fix now with an explicit plan amendment,
   or defer to a follow-up and ship the misleading string.
3. **Is the Supabase project-global storage limit ≥ 16 MB?** One dashboard lookup; blocks
   nothing in code but determines whether the first real 16 MB upload 200s or 500s.

## Verdict: CONDITIONAL

The code is sound and I would merge it. It must not pass the acceptance check until:

- **C1 (blocking for "done")** I-2 runs on the prod test tenant and Kapso mints a `4:` handle
  for a video header (Integration Map row 13).
- **C2 (blocking for release)** the Supabase project global storage limit is confirmed ≥ 16 MB.
- **C3 (decide, then act)** 🟡-1: either correct the `videoFileError` message (with the plan
  bullet and its one frozen assertion amended in the same change) or log it as an accepted
  follow-up in the kanban entry.

🟢 items are optional; 🟢-3 and 🟢-5 are worth one backlog line each.

## Next Steps

1. Orchestrator: rule on C3 before the branch is closed; the fix is one string plus one
   assertion and is cheaper now than after release.
2. Release runbook: carry C1, C2 and the memory-headroom note from 🟡-2; copy the deploys
   artifact into the branch's workspace (or accept it lives only in the main checkout).
3. `ui-test-runner` / I-1 still owes the browser walk. Per plan R4 expect only the form legs
   (Video option, hint, type-switch clearing) to be exercisable on DEV; record which legs ran.
4. No re-review needed for 🟢 items. If C3 is fixed, a one-line confirmation of the changed
   string and its assertion is sufficient — no new review artifact.
