---
id: plans/2026-09-09-tpl-011-video-template-header
type: plan
author: solution-architect
created: 2026-09-09
status: active
supersedes: null
superseded_by: null
related: [kanban:TPL-011, plans/2026-08-24-camp-007-media-header-send, reviews/2026-07-17-tpl-004-image-header-upload-gemini-r2, reviews/2026-07-17-tpl-004-image-header-upload-grok-round2, deploys/2026-09-09-tpl-011-video-upload-body-limit]
---

# Plan: TPL-011 — VIDEO header for WhatsApp marketing templates

## Objective

Let a dashboard operator create or edit a WhatsApp template whose header is a **video**
(MP4 or 3GP, ≤ 16 MB), the same way image headers work today: the file is uploaded to the
public `wa-template-media` bucket, the row stores the public URL under
`example.header_handle[0]`, and at submit time `resolveHeaderMedia` mints the Meta `4:`
handle through the Kapso Platform Media API. No send-path change: CAMP-007 already emits
`{type:'video', video:{link}}` for a VIDEO header (`send-template-message.test.ts:271`).

Scope: **Small** (one new form option + one new uploader + policy widening on an existing
route). No new entity, no migration, no new port.

## Context

Verified in the worktree (`feature/tpl-011`, base a67f76e):

| Area | Fact | Consequence |
|---|---|---|
| `src/app/api/dashboard/upload/route.ts` | `ALLOWED_TYPES` = jpeg/png/webp, `MAX_FILE_SIZE` = 5 MB, applied to all three buckets (`tenant-assets`, `wa-template-media`, `campaign-images`) | Video must be admitted for `wa-template-media` only, at 16 MB; images stay 5 MB everywhere |
| `src/app/api/dashboard/upload/upload-path.ts` `normalizeExt` | mime tail used verbatim except `jpeg→jpg`; `video/3gpp` → `.3gpp` | Add `3gpp→3gp`; `video/mp4` already yields `.mp4` |
| `ImageUploader` (`image-uploader.tsx`) | sends NO `path` → server derives `${restaurantId}/${ts}.${ext}` | The stored URL's extension is exactly what `normalizeExt` produces, so the Kapso adapter's `mimeFromUrl` depends on the ext map above |
| `src/infrastructure/kapso/template-media-upload.ts` | `MIME_BY_EXT` = png/webp/jpg/jpeg, fallback `image/jpeg`; `invalidSourceUrl` messages say "header image" | Add `mp4`, `3gp`; neutral wording |
| `src/application/resolve-header-media.ts` | format-agnostic (`isMediaHeader`); `mapMediaHandleError` says "Image upload is not configured" / "Could not upload the header image to Meta" | Neutral wording; two tests assert the old string (`resubmit/__tests__/route.test.ts:150`, `create-whatsapp-template.test.ts:330`) |
| `src/application/enforce-header-media.ts` | message ends "with a hosted header image before sending" | Neutral wording; no test asserts the text (`campaign-queue.test.ts:196` only checks the class) |
| `src/domain/services/template-media-header.ts`, `validate-template-components.ts`, `prepare-template-components.ts`, `whatsapp-template.ts` (`HeaderFormat`) | already include VIDEO | **No domain change** |
| `wa-template-form-types.ts` | `headerType: 'none'\|'text'\|'image'`, `headerImageUrl`; `templateToFormState` maps only IMAGE; `buildWaTemplateRequestBody` emits only IMAGE | Add `'video'` + VIDEO round-trip |
| `wa-template-form-dialog.tsx:50` `handleChange` | generic spread — switching header type keeps the old URL | A video URL left under `headerType:'image'` would be submitted as IMAGE with an `.mp4` → Meta rejects; clearing on type change is required |
| `wa-template-form-fields.tsx` `HeaderSection` | hard-coded `<option>` None/Text/Image, `ImageUploader bucket="wa-template-media"`, hint `t('imageHeaderHint')` under testid `image-header-hint` | Add Video option, `VideoUploader`, `videoHeaderHint` |
| `ImageUploader` callers | `welcome-image-fields.tsx`, `campaign-image-uploader.tsx`, `tenant-logo-section.tsx`, `wa-template-form-fields.tsx` | Must be behaviourally untouched |
| Header thumbnail surfaces outside the form | grep of `'IMAGE'`/`header_handle`/`headerHandle` in non-test `src/` hits only the domain/application files above; `wa-template-table.tsx` and `admin/(dashboard)/template-reviews` render no header media | **None to change** (confirmed) |
| i18n | `waTemplates.imageHeaderHint` at `en.json:842` / `zh-HK.json:842`; `locale-parity.test.ts` proves same keys in both files; `csv-i18n-keys.test.ts` is the precedent for pinning required keys | Add `videoHeaderHint` to both + pin |
| Tests referencing form field names | `headerImageUrl` is referenced by **no** test (`wa-template-form-fields.test.tsx` references `headerType` and `imageHeaderHint` only; `form-types.test.ts` has no header cases) | Rename is cheap |
| Route-test precedent | `imports/proof-upload/__tests__/route.test.ts` (mock `tenant-guard`, build `NextRequest` with `FormData`) | Reuse for the new upload route test |
| Bucket | migration 055: `wa-template-media` public, no per-bucket size/mime limit | Server route is the only guard |
| Kapso video ingest | `media_ingest.mime_type` is passed through; whether `delivery:'meta_resumable_asset'` accepts `video/mp4` is **unverified**. No local Kapso docs; no `.mp4` fixture in the repo; `KAPSO_API_KEY` present in the main checkout's `.env.local` | Verification step below (A-6) + post-deploy verify |
| Infra | nginx `client_max_body_size` on the Forge box is being checked by devops (artifact `deploys/2026-09-09-tpl-011-video-upload-body-limit`, may not exist yet) | Deploy precondition, not a code task |
| Mechanical gate | no `gate` script in this repo: `npm run lint` (eslint flat config), `npx tsc --noEmit`, `npm test` (vitest) | Acceptance uses these three |

Meta constraints the hints and policy encode (from the Cloud API media reference, established
by the caller): video = `video/mp4` (.mp4) / `video/3gpp` (.3gp), ≤ 16 MB, H.264 + AAC,
single or no audio stream; H.264 High profile with B-frames unsupported on Android. Images
stay 5 MB (JPEG/PNG). Template creation shape for VIDEO is identical to IMAGE:
`{type:'HEADER', format:'VIDEO', example:{header_handle:[handle]}}`.

## Domain Model

No new entities or value objects. `HeaderFormat` already carries `'VIDEO'`. The only new
shape is UI form state:

- `WaTemplateFormState.headerType: 'none' | 'text' | 'image' | 'video'`
- `WaTemplateFormState.headerMediaUrl: string` (renamed from `headerImageUrl`) — one URL slot
  for whichever media type `headerType` selects. Rejected alternative: a separate
  `headerVideoUrl`. Two slots would let a stale URL of the other type ride along and would
  double every clear/round-trip branch for no domain reason; the format is already the
  discriminator.

### Cross-stream contract (A and B must both honour, neither may change)

1. Upload: `POST /api/dashboard/upload?bucket=wa-template-media` with multipart `file`
   (no `path`) → `200 {url}` where `url` is the Supabase public object URL ending in
   `.mp4` or `.3gp` (server-derived from the mime); any policy violation → `400 {error}`.
2. Stored/submitted component: `{type:'HEADER', format:'VIDEO', example:{header_handle:[url]}}`
   — exactly the IMAGE shape with the format changed. The row keeps the URL; only the
   submit-time copy carries the minted `4:` handle (unchanged TPL-004 invariant).
3. Error contract from submit paths is unchanged (`errorCode: provider_not_configured |
   provider_error`); only the human message wording changes.

## Design decisions

1. **Per-bucket upload policy as a pure module.** New
   `src/app/api/dashboard/upload/upload-policy.ts` exporting
   `checkUploadPolicy({bucket, mime, size}) → null | {error: string}` and the constants:
   `IMAGE_TYPES` (jpeg/png/webp, 5 MB, every bucket), `VIDEO_TYPES` (`video/mp4`,
   `video/3gpp`, 16 MB, **only** `wa-template-media`). Limit check keeps the existing
   `size > limit` semantics (a file of exactly the limit is accepted). Messages:
   `Invalid file type: <mime>. Allowed: JPEG, PNG, WebP.` (image-only buckets) /
   `... Allowed: JPEG, PNG, WebP, MP4, 3GP.` (`wa-template-media`) /
   `File exceeds 5MB limit.` / `File exceeds 16MB limit.` The route keeps its shape and
   replaces the two inline checks with one call. Pure module → unit tests without the
   route harness; route test covers only the 400 wiring.
2. **Sibling `VideoUploader`, not a parameterised `ImageUploader`.** A new
   `src/components/dashboard/video-uploader.tsx` (same props as `ImageUploader`:
   `bucket, currentUrl, onUploaded, onRemoved?, className?`) with
   `accept="video/mp4,video/3gpp"`, a `<video src preload="metadata" muted controls>`
   preview in the same 80×80 frame, and the same `common.generate/regenerate/loading`
   labels. The four existing `ImageUploader` callers are untouched. Two additions the
   image path lacks, both justified by the 16 MB size: a client-side pre-check
   (`file.size > 16 MB` → show the server's exact message without uploading; a mime
   outside `video/mp4`/`video/3gpp` → `Invalid file type: <mime>. Allowed: MP4, 3GP.`,
   this uploader's own allow-list, not the bucket's — the bucket also accepts images on
   this slot but this uploader never does) and a non-JSON-tolerant response read (an
   nginx 413 returns HTML; `res.json()` would throw `Unexpected token` at the operator;
   a 200 with no non-empty `url` throws `Upload failed: server returned no file URL`
   rather than silently resetting the uploader). Both live in a pure helper file
   `video-uploader-helpers.ts` (precedent: `campaign-image-uploader-helpers.ts`) so they
   are testable without DOM. Accepted duplication: the 12-line upload fetch now exists in
   three components (ImageUploader, CampaignImageUploader, VideoUploader) — DRY says
   extract on the third, but touching the two existing components is outside this ask;
   **mention as a follow-up, do not refactor here.**
3. **Header-type change clears the media URL via a pure helper.** Add
   `applyWaTemplateFormChange(form, key, value): WaTemplateFormState` to
   `wa-template-form-types.ts` (mirrors `applyTemplateButtonChange`): when
   `key === 'headerType'` and the value differs from the current one, `headerMediaUrl`
   is reset to `''`; every other key is a plain assignment. `handleChange` in the dialog
   delegates to it. `headerText` is left as-is on type change (pre-existing behaviour,
   harmless on the wire, out of scope).
4. **Media-neutral wording, same error codes.** `mapMediaHandleError`:
   `Media upload is not configured` / `Could not upload the header media to Meta`.
   `invalidSourceUrl`: "header media URL …". `TemplateHeaderMediaMissingError`:
   "… with a hosted header image or video before sending". Comments that claim
   "header media in this product is always an image" are updated in the same edit.
5. **Extension map, not content sniffing.** `normalizeExt`: `3gpp → 3gp`.
   `MIME_BY_EXT`: `mp4 → video/mp4`, `3gp → video/3gpp`; fallback stays `image/jpeg`
   (the dashboard can no longer produce an unmapped extension for this bucket).
   `mimeFromUrl` already strips the query string; the tests below pin that for the
   new extensions.
6. **Hard-coded option labels stay hard-coded.** The `<select>` labels None/Text/Image are
   English literals today; "Video" follows the same style (surgical). Only the hint is
   i18n'd, as for images.

## Subtasks

TDD order inside every task: the test file is written and shown failing before the
implementation. Stream A and Stream B are independent and are dispatched in parallel; I-1
runs after both. Stream A's **first act** is the frozen acceptance suite for A (A-0);
Stream B's first act is the frozen suite for B (B-0).

### Stream A — backend (senior-backend-dev)

- **A-0 Frozen acceptance suite (A).** Author every A-side test named in *Acceptance
  test list* as failing tests under the existing `__tests__` folders; commit them; show
  the red run. Not renegotiated afterwards.
- **A-1 `upload-policy.ts` + `__tests__/upload-policy.test.ts`.** Pure policy module per
  decision 1. Depends on: nothing.
- **A-2 Upload route wiring + `__tests__/route.test.ts`.** Replace the inline
  `ALLOWED_TYPES`/`MAX_FILE_SIZE` checks in `upload/route.ts` with `checkUploadPolicy`;
  route test per the proof-upload precedent (mock `tenant-guard` and
  `@/infrastructure/supabase/client`). Depends on: A-1.
- **A-3 `upload-path.ts` `normalizeExt`** `3gpp → 3gp` + tests in
  `upload-path.test.ts`. Depends on: nothing.
- **A-4 Kapso adapter** `template-media-upload.ts`: `MIME_BY_EXT` entries, neutral
  `invalidSourceUrl` strings, updated comment; tests in
  `template-media-upload.test.ts`. Depends on: nothing.
- **A-5 Application wording**: `resolve-header-media.ts` (`mapMediaHandleError` + doc
  comment), `enforce-header-media.ts`; update the two tests that assert the old string
  (`resubmit/__tests__/route.test.ts:150`, `create-whatsapp-template.test.ts:330`) and
  add an assertion in `enforce-header-media.test.ts` on the new message. Depends on:
  nothing.
- **A-6 Kapso video-ingest probe (best effort, bounded to 30 min).** Using the main
  checkout's `.env.local` `KAPSO_API_KEY` (read it, never copy it into the worktree or
  an artifact), a dev `phone_number_id`, and a tiny H.264/AAC `.mp4` generated locally
  (e.g. `ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=10 -f lavfi -i
  anullsrc -c:v libx264 -c:a aac -shortest -t 1 probe.mp4`, kept in the scratchpad,
  never committed), upload it under a **test tenant** prefix in `wa-template-media` via
  the dashboard route or the Supabase client, then call the Kapso media endpoint with
  `mime_type: 'video/mp4'` and record the verbatim response (status + body, key
  redacted) in the A handoff. Outcomes: `data.target.handle` starting `4:` → verified;
  4xx naming the mime or delivery → **stop and report** (fallback options in R1);
  the TPL-004-era "WhatsApp configuration not found" 404 on the dev key → inconclusive,
  post-deploy verify (I-2) becomes mandatory. Delete the probe object afterwards.
  Depends on: A-4 (so the probe exercises the real adapter, not a hand-rolled fetch).

### Stream B — frontend (react-frontend-dev)

- **B-0 Frozen acceptance suite (B).** Author every B-side test named below as failing
  tests; commit; show the red run.
- **B-1 Form state** `wa-template-form-types.ts`: `headerType` gains `'video'`;
  `headerImageUrl → headerMediaUrl` (rename in `initialWaTemplateForm`,
  `templateToFormState`, `buildWaTemplateRequestBody`, `extractImageUrl →
  extractMediaUrl`); VIDEO round-trip both directions; new
  `applyWaTemplateFormChange`. Tests in `wa-template-form-types.test.ts`.
  Depends on: nothing.
- **B-2 `video-uploader-helpers.ts` + `video-uploader.tsx`** per decision 2. Tests in
  `__tests__/video-uploader-helpers.test.ts` (pure: size pre-check, accept list,
  response reader on JSON / non-JSON / non-OK). Depends on: nothing.
- **B-3 `HeaderSection`** in `wa-template-form-fields.tsx`: `<option value="video">Video</option>`,
  `VideoUploader bucket="wa-template-media"` bound to `headerMediaUrl`, hint
  `t('videoHeaderHint')` under `data-testid="video-header-hint"`; image branch re-bound
  to `headerMediaUrl`. Tests in `wa-template-form-fields.test.tsx` (mock
  `@/components/dashboard/video-uploader` exactly like the image mock).
  Depends on: B-1, B-2.
- **B-4 i18n**: `waTemplates.videoHeaderHint` in `en.json` and `zh-HK.json` next to
  `imageHeaderHint`. EN: "MP4 or 3GP, up to 16MB, H.264 video with AAC audio (or no
  audio). The video is uploaded to WhatsApp when you submit the template, and Meta
  reviews it before the template can be used." zh-HK equivalent in the register of the
  existing image hint. New `src/messages/__tests__/wa-templates-i18n-keys.test.ts`
  pinning `waTemplates.imageHeaderHint` and `waTemplates.videoHeaderHint` in both
  locales (precedent `csv-i18n-keys.test.ts`). Depends on: nothing.
- **B-5 Dialog** `wa-template-form-dialog.tsx:50`: `handleChange` delegates to
  `applyWaTemplateFormChange`. Depends on: B-1.

### Integration (react-frontend-dev, after A and B land on `feature/tpl-011`)

- **I-1 Wiring walk (Integration Map as checklist)** + end-to-end walk from the app
  entry point: sign in → Dashboard → WA Templates → New → Header: **Video** → upload a
  ≤16 MB mp4 → submit → the saved row carries the VIDEO component with the public URL →
  edit the same template → the Video option and the preview are pre-selected → switch
  header to Image → URL is cleared. Browser-verify with `ui-test-runner` on the dev env
  **if** the dev DB has migration 055 (see R4); otherwise run the route + form tests as
  the wiring proof and record the gap explicitly. Also confirm a `.png` upload to
  `campaign-images` and `tenant-assets` still succeeds and a `.mp4` to either still
  returns 400.
- **I-2 Post-deploy verify (prod, test tenant)** — owned by the release runbook, not
  code: create a video-header template under the pinned test tenant, confirm the
  submit returns 201/pending (Kapso minted a handle for video), then confirm Meta's
  status sync moves it to approved/rejected with a reason. This is the only place
  contract 2 is proven against Meta.

## Integration Map

| # | Wiring point | File | Subtask |
|---|---|---|---|
| 1 | Header type option `Video` in the form select | `wa-template-form-fields.tsx` `HeaderSection` | B-3 |
| 2 | `headerType` union gains `'video'`; `headerMediaUrl` field | `wa-template-form-types.ts` | B-1 |
| 3 | Stored VIDEO → form state (edit path) | `templateToFormState` | B-1 |
| 4 | Form state → VIDEO component (create/edit request) | `buildWaTemplateRequestBody` | B-1 |
| 5 | Type-switch clears the URL | `applyWaTemplateFormChange` + dialog `handleChange` | B-1, B-5 |
| 6 | Video uploader with `accept="video/mp4,video/3gpp"` + preview | `video-uploader.tsx` | B-2 |
| 7 | i18n `waTemplates.videoHeaderHint` in **both** locales + key pin | `en.json`, `zh-HK.json`, i18n keys test | B-4 |
| 8 | Upload policy table: video types + 16 MB, `wa-template-media` only | `upload-policy.ts` | A-1 |
| 9 | Upload route uses the policy (400 wiring) | `upload/route.ts` | A-2 |
| 10 | Extension map `3gpp → 3gp` | `upload-path.ts` | A-3 |
| 11 | `MIME_BY_EXT` `mp4`/`3gp` | `template-media-upload.ts` | A-4 |
| 12 | Media-neutral error strings (3 sites) | `template-media-upload.ts`, `resolve-header-media.ts`, `enforce-header-media.ts` | A-4, A-5 |
| 13 | Kapso accepts `video/mp4` ingest | probe / prod verify | A-6, I-2 |
| 14 | nginx `client_max_body_size` ≥ 16 MB (+ multipart overhead → 20M recommended) on the Forge box | deploys artifact | deploy precondition |
| 15 | No DI, permission, feature-flag, route, or nav change needed (existing page + route) | — | confirmed in INVESTIGATE |

## Acceptance Criteria

1. The template form offers Header = Video; choosing it shows a video uploader and the
   video hint in the active locale; a valid `.mp4` ≤ 16 MB uploads and previews inline.
2. Submit produces `{type:'HEADER', format:'VIDEO', example:{header_handle:[url]}}`;
   reopening the template pre-selects Video with the same URL.
3. Switching the header type away from Video (or Image) clears the stored URL.
4. `POST /api/dashboard/upload`: `video/mp4`/`video/3gpp` up to 16 MB accepted for
   `wa-template-media`; rejected with 400 for the other two buckets; images remain
   5 MB on every bucket; a 3GP file is stored with a `.3gp` extension.
5. The Kapso adapter sends `mime_type: video/mp4` / `video/3gpp` for the matching URL
   extensions, including with a query string; all "header image" wording on the
   upload/mint/send-guard path is media-neutral, with error codes unchanged.
6. `waTemplates.videoHeaderHint` exists in both locale files (parity test green, key
   pin test green).
7. Feature reachable end to end from the app entry point (I-1), other `ImageUploader`
   callers unchanged, and the send path untouched (`git diff` shows no change under
   `send-template-message.ts`, `template-client.ts`, `template-media-header.ts`).
8. Mechanical gate green on the final tree: `npx tsc --noEmit`, `npm run lint`,
   `npm test`. No test in the frozen suites weakened or deleted (diff the suites).

## Acceptance test list

Stream A (frozen in A-0):

- `upload-policy.test.ts`
  - image/jpeg, image/png, image/webp accepted on all three buckets at exactly 5 MB;
    5 MB + 1 byte → `File exceeds 5MB limit.` on all three buckets.
  - video/mp4 and video/3gpp on `wa-template-media` at exactly 16 MB accepted;
    16 MB + 1 byte → `File exceeds 16MB limit.`.
  - video/mp4 on `campaign-images` → `Invalid file type: video/mp4. Allowed: JPEG, PNG, WebP.`;
    same for `tenant-assets`.
  - unknown mime (`application/octet-stream`, `video/quicktime`, `image/gif`) rejected on
    every bucket; the `wa-template-media` message lists `JPEG, PNG, WebP, MP4, 3GP`.
  - an image on `wa-template-media` is still capped at 5 MB (video limit does not leak).
- `upload/__tests__/route.test.ts`
  - 400 with the policy message for `video/mp4` on `campaign-images`.
  - 400 `File exceeds 16MB limit.` for a 16 MB + 1 video on `wa-template-media`.
  - 200 `{url}` for a small `video/3gpp` on `wa-template-media`, and the storage
    `upload` mock was called with a path ending `.3gp` and `contentType: 'video/3gpp'`.
  - existing behaviour retained: invalid bucket 400, no file 400, `AuthError` passthrough.
- `upload-path.test.ts`
  - `video/3gpp` → `r-1/<ts>.3gp`; `video/mp4` → `r-1/<ts>.mp4`.
- `template-media-upload.test.ts`
  - `.mp4` URL → `mime_type: 'video/mp4'`; `.3gp` → `'video/3gpp'`; `.MP4` (upper case)
    → `'video/mp4'`; `.mp4?token=abc` → `'video/mp4'`; `filename` is the path's last
    segment.
  - unknown extension still falls back to `image/jpeg` (pinned so the fallback is a
    decision, not an accident).
  - `fetch_failed` details for http / credentials / foreign host no longer contain the
    word "image" (regex `/image/i` absent) and do contain "media".
- `resolve-header-media.test.ts`
  - `mapMediaHandleError({title:'not_configured'})` → `Media upload is not configured`,
    `provider_not_configured`; `upload_failed` without details → `Could not upload the
    header media to Meta`, `provider_error`; `details` still passes through verbatim.
  - a VIDEO header with an https URL is minted (adapter called with that URL) and the
    minted `4:` handle replaces the URL, `headerHandle` key removed — same assertions as
    the IMAGE case.
- `enforce-header-media.test.ts`
  - message for a VIDEO header without a usable URL mentions "image or video" and
    contains no "header image" phrase.
- `resubmit/__tests__/route.test.ts:150` and `create-whatsapp-template.test.ts:330`:
  updated to the new string (these two edits are the only changes to pre-existing
  assertions in the A suite; list them in the handoff).

Stream B (frozen in B-0):

- `wa-template-form-types.test.ts`
  - `templateToFormState` with `{type:'HEADER', format:'VIDEO', example:{header_handle:[U]}}`
    → `headerType:'video', headerMediaUrl:U`; with IMAGE → `'image'`; with an empty
    `header_handle` → `headerMediaUrl:''`.
  - `buildWaTemplateRequestBody({headerType:'video', headerMediaUrl:U})` → the exact VIDEO
    component of contract 2 and no IMAGE component; `'image'` still emits IMAGE;
    `'none'`/`'text'` emit no `example`.
  - round-trip property: for each media format in `['IMAGE','VIDEO']` and any https URL,
    `buildWaTemplateRequestBody(templateToFormState(row)).components[0]` deep-equals the
    input header component.
  - `applyWaTemplateFormChange`: `headerType` image→video clears `headerMediaUrl`;
    video→none clears it; setting the same type again keeps it; changing `body` leaves
    `headerMediaUrl` untouched; the function never mutates its input.
- `video-uploader-helpers.test.ts`
  - `videoFileError(file)`: > 16 MB → `File exceeds 16MB limit.`; exactly 16 MB → null;
    mime outside `video/mp4|video/3gpp` → `Invalid file type: <mime>. Allowed: MP4,
    3GP.` (this uploader's own allow-list, not the bucket's — see decision 2); ok file
    → null.
  - `readUploadResponse(res)`: 200 JSON `{url}` → `{url}`; 200 JSON with no `url` or an
    empty-string `url` → throws `Upload failed: server returned no file URL`; 400 JSON
    `{error}` → throws `error`; 413 HTML body → throws a readable "File is too large for
    the server" message, never a JSON parse error.
  - the exported `VIDEO_ACCEPT` equals `'video/mp4,video/3gpp'`.

**Amended 2026-09-09 after review `reviews/2026-09-09-tpl-011-video-header-analyzer`
🟡-1 / 🟢-4.**
- `wa-template-form-fields.test.tsx`
  - `headerType:'video'` renders `video-header-hint` with `t:videoHeaderHint` and no
    `image-header-hint`; `'image'` renders the image hint only; `'none'`/`'text'` render
    neither; the select contains an option with `value="video"`.
- `wa-templates-i18n-keys.test.ts`
  - `waTemplates.imageHeaderHint` and `waTemplates.videoHeaderHint` present and non-empty
    in `en.json` and `zh-HK.json`; EN video hint mentions `16MB` and `MP4`.

Integration (I-1): the walk above, recorded step by step with what was actually exercised.

## Performance Budgets

| Surface | Budget | Rationale |
|---|---|---|
| Upload route server time for a 16 MB video (excluding network transfer) | ≤ 2 s p95 | The route buffers the file once (`arrayBuffer` → `Buffer`) and forwards to Supabase; 16 MB in memory is acceptable on the e2-medium box for a single dashboard user, no streaming rework in scope |
| Uploader feedback | loading state within 100 ms of file pick; client size/type rejection instant (no request) | Pre-check in `videoFileError` |
| Template submit with a video header (Kapso fetches the 16 MB and runs Meta's resumable upload) | ≤ 30 s p95, hard ceiling = nginx `proxy_read_timeout` on the Forge box (default 60 s) | Measured in I-2; if the p95 exceeds 30 s, open a follow-up for async minting — not in scope |
| Existing image path | unchanged (no additional work introduced) | Policy check is O(1) |

## Out of Scope

- DOCUMENT headers (PDF) — same mechanism, separate ask.
- Rendering a video/image thumbnail in the template list or the admin template-review
  page (none exists today for images either).
- Streaming the upload instead of buffering; async/queued handle minting.
- Extracting the shared upload fetch out of `ImageUploader` / `CampaignImageUploader`
  (third copy now exists — follow-up, not this diff).
- Server-side transcoding or codec validation (H.264 profile, B-frames): Meta reviews
  and rejects; the hint states the constraints.
- Send-path changes (already shipped in CAMP-007).

## Risks & Open Questions

- **R1 Kapso video ingest unverified.** `media_ingest` is documented (by our own TPL-004
  status note) for images only. If A-6 shows Kapso rejects `video/*` for
  `meta_resumable_asset`, the whole feature is blocked at submit time. Fallbacks, in
  order: ask Kapso support (they confirmed the image path on 2026-07-17); Meta's own
  App-level resumable upload (needs an app id + Graph token we do not hold — the
  TPL-004 dead end). Decision if blocked: ship the upload/form work behind the existing
  `provider_error` surface (operator sees Kapso's message, row stays draft) and open a
  follow-up; do not add a feature flag for this.
- **R2 Browser mime for 3GP.** Some browsers report `''` or `video/3gpp2` for `.3gp`
  files; the policy accepts `video/3gpp` only. Accepted: 3GP is a legacy format; MP4 is
  the documented primary. Mentioned in the hint by listing both.
- **R3 Submit latency.** Kapso must fetch up to 16 MB and push it to Meta inside the
  synchronous create/update/resubmit request. See the budget table; the nginx
  `proxy_read_timeout` is the ceiling, and the devops artifact should record its value
  alongside `client_max_body_size`.
- **R4 No dev browser walk for the bucket.** Memory: DEV Supabase lags prod by ~30
  migrations; `wa-template-media` is migration 055 and may be absent on DEV, and local
  `supabase start` segfaults. If so, I-1's browser walk is limited to the form (Video
  option, hint, type-switch clearing) and the upload/submit legs are proven by the route
  and form tests plus I-2 on the prod test tenant. Record exactly which legs ran.
- **R5 nginx body limit.** Until `deploys/2026-09-09-tpl-011-video-upload-body-limit`
  confirms ≥ 16 MB (recommend `20M` for multipart overhead), a prod upload above the
  current limit returns an nginx 413 HTML page; `readUploadResponse` turns that into a
  readable message rather than a parse error, but the feature is not usable until the
  limit is raised. Release order: nginx change first, then deploy.
- **Assumption (logged, caller silent):** `webp` stays accepted for images (existing
  behaviour) even though Meta lists JPEG/PNG only — not changed here.
- **Assumption:** the option label "Video" stays an English literal like its siblings;
  localising the four labels is a separate i18n item.
