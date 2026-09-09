---
id: artifacts/2026-09-09-tpl-011-stream-a-backend
type: artifact
author: senior-backend-dev
created: 2026-09-09
status: active
supersedes: null
superseded_by: null
related: [kanban:TPL-011, plans/2026-09-09-tpl-011-video-template-header]
---

# TPL-011 Stream A (backend) — VIDEO template header

Implements Stream A of `plans/2026-09-09-tpl-011-video-template-header` (subtasks
A-0…A-6) on `feature/tpl-011` in the shared worktree
`/Users/xavierau/Code/js/whatsapp-crm-tpl-011-worktree`, concurrently with Stream B
(react-frontend-dev) in the same working tree.

## Commits

| Commit | What |
|---|---|
| `f71dfb3` | Frozen A-0 acceptance suite — **shared commit** (see Note below) |
| `12f35b4` | A-1…A-5 implementation |

**Note on `f71dfb3`:** I staged my 8 Stream A test files with `git add <exact paths>`
and ran `git commit`, which failed with "no changes added to commit" — Stream B's
concurrent `git add` + `git commit` in the same shared worktree had already swept my
staged files into their commit (same index, no `index.lock` collision, so the race
wasn't caught by the documented "wait and retry on `index.lock`" guard). The commit
`f71dfb3` is titled "Stream B" but its diff contains all of Stream A's A-0 test
files too (verified: `git diff HEAD` against my intended content was empty).
Content is correct and on the branch; only the commit's authorship framing is
imprecise. No corrective action taken — a second commit would just be noise. Flagging
so future concurrent same-worktree dispatches know the failure mode isn't only
`index.lock`.

## Files Changed

| File | Change | Subtask |
|---|---|---|
| `src/app/api/dashboard/upload/upload-policy.ts` | new — `checkUploadPolicy({bucket,mime,size})`, `IMAGE_TYPES`/`VIDEO_TYPES` tables | A-1 |
| `src/app/api/dashboard/upload/__tests__/upload-policy.test.ts` | new — 40 cases | A-0/A-1 |
| `src/app/api/dashboard/upload/route.ts` | inline `ALLOWED_TYPES`/`MAX_FILE_SIZE` checks replaced by `checkUploadPolicy` call | A-2 |
| `src/app/api/dashboard/upload/__tests__/route.test.ts` | new — 7 cases (policy wiring + existing-behaviour retention) | A-0/A-2 |
| `src/app/api/dashboard/upload/upload-path.ts` | `normalizeExt`: `3gpp → 3gp` | A-3 |
| `src/app/api/dashboard/upload/__tests__/upload-path.test.ts` | +2 cases (3gpp, mp4) | A-0/A-3 |
| `src/infrastructure/kapso/template-media-upload.ts` | `MIME_BY_EXT` +`mp4`/`3gp`; `invalidSourceUrl` + doc comments reworded "image" → "media" | A-4 |
| `src/infrastructure/kapso/__tests__/template-media-upload.test.ts` | +6 cases (mp4/3gp mime derivation, case-insensitivity, query string, unknown-ext fallback pin, media-neutral wording) | A-0/A-4 |
| `src/application/resolve-header-media.ts` | `mapMediaHandleError` + doc comment reworded to media-neutral | A-5 |
| `src/application/__tests__/resolve-header-media.test.ts` | +4 cases (VIDEO minting, `mapMediaHandleError` × 3) | A-0/A-5 |
| `src/application/enforce-header-media.ts` | `TemplateHeaderMediaMissingError` message: "...header image before sending" → "...header image or video before sending" | A-5 |
| `src/application/__tests__/enforce-header-media.test.ts` | +1 case | A-0/A-5 |
| `src/app/api/dashboard/wa-templates/resubmit/__tests__/route.test.ts:150` | pre-existing assertion updated | A-0/A-5 |
| `src/application/__tests__/create-whatsapp-template.test.ts:330` | pre-existing assertion updated | A-0/A-5 |

**The only two pre-existing assertions changed** (as named by the plan, verbatim
line numbers confirmed before editing):
- `resubmit/__tests__/route.test.ts:150`: `'Image upload is not configured'` →
  `'Media upload is not configured'`
- `create-whatsapp-template.test.ts:330`: same string change

No other pre-existing test in these 8 files was touched; 63 pre-existing tests in
them stayed green in the A-0 red run (before implementation) and stayed green
after.

## Key Decisions

- **Policy module shape** matches plan decision 1 exactly: image types accepted on
  every bucket at 5MB, video types accepted only on `wa-template-media` at 16MB,
  everything else 400s with a bucket-appropriate allow-list string. Limit check is
  `size > limit` (a file at exactly the limit passes) — this fixed a subtlety the
  test list called out explicitly (image size cap does not leak the video limit
  onto `wa-template-media`).
- **`enforce-header-media.test.ts` "no header image phrase" assertion**: the plan's
  acceptance bullet says the VIDEO message "contains no 'header image' phrase," but
  design decision 4's literal final wording is "...with a hosted header image **or
  video** before sending" — which does contain the substring "header image." I
  interpreted the bullet's intent (prove the wording actually changed from the
  image-only original) rather than its literal substring reading, since the literal
  reading contradicts the design decision's stated final string. The test asserts
  the message matches `/image or video/` and does **not** contain the old
  unbroken phrase `'header image before sending'`. Flagging this interpretation
  explicitly since it's a judgment call made while authoring A-0, not something
  renegotiated afterward.
- **Doc-comment touch-ups beyond the plan's three named sites**: `resolve-header-media.ts`'s
  top docstring and `template-media-upload.ts`'s top docstring both said "image"
  where the code now handles media generally. Since both files were already being
  edited for A-4/A-5, I reworded these two comments in the same edit rather than
  leaving stale docs beside media-neutral code. Not test-covered; purely
  documentation.
- **`upload-policy.ts` is a pure module** (no route/Next.js/Supabase imports), so
  A-1's tests run without any route harness, matching plan decision 1's stated
  rationale.

## Tests

- Stream A acceptance suite (A-0, frozen): **110 tests, 8 files, all green** after
  A-1…A-5 landed.
- Full project suite (`npm test`), run twice — once immediately after the Stream A
  implementation commit, once again after Stream B's implementation landed in the
  shared worktree: **434 files / 4417 tests passed, 21 skipped, 2 todo, 0 failures**
  both times. The documented WAQ webhook integration flake did not manifest in
  either run; no isolation rerun was needed.
- `npx tsc --noEmit`: clean on all Stream A files both before and after Stream B
  landed (the only errors seen mid-flight were in Stream B's still-in-progress
  files, none in Stream A's).
- `npm run lint` (scoped to the 14 Stream A files, changed + new): clean, 0 output.
- `git diff HEAD -- '*send-template-message.ts' '*template-client.ts'
  '*template-media-header.ts'`: empty — send path confirmed untouched (AC7).

## A-6 Kapso video-ingest probe — verbatim outcome

Ran within the 30-minute budget. Method: generated a 1s H.264/AAC mp4 locally
(`ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=10 -f lavfi -i anullsrc
-c:v libx264 -c:a aac -shortest -t 1`, ~8.6KB) in the session scratchpad. Wrote a
temporary driver script (`scripts/tpl-011-probe.ts`, never staged/committed, deleted
immediately after the run) that: loaded `KAPSO_API_KEY` /
`NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `DEMO_RESTAURANT_ID` from
the **main checkout's** `.env.local` only (never copied into the worktree, a commit,
or this artifact); looked up a `kapso_phone_number_id` (via the demo restaurant,
falling back to any restaurant row with one set); uploaded the probe mp4 to
`wa-template-media` under `probe-tpl-011/<ts>.mp4` via the real service-role
Supabase client; called the **real adapter** `uploadHeaderMediaFromUrl` from
`template-media-upload.ts` (not a hand-rolled fetch) with `mime_type: 'video/mp4'`;
then deleted the probe object.

Verbatim result (API key never appears in this output):

```json
{
  "ok": false,
  "handle": null,
  "error": {
    "title": "upload_failed",
    "details": "Kapso media ingest failed (404): {\"error\":\"WhatsApp configuration not found\"}"
  }
}
```

Probe object cleanup confirmed removed (`cleanup removed probe object: true`).

**Classification: inconclusive** — this is exactly the TPL-004-era "WhatsApp
configuration not found" 404 the plan names as the inconclusive case (the dev key's
bound WABA/app context doesn't resolve on this endpoint, independent of the mime
type), not a mime-type or `delivery` rejection. Per the plan, **I-2 (post-deploy
verify on the prod test tenant) is now mandatory** — this probe neither confirms nor
rules out R1 (Kapso video ingest support). If I-2 later returns a 4xx that *names*
the mime type or `delivery` value, that's the R1 blocked case with its fallback
order (Kapso support → Meta's own resumable upload, which needs an app id/Graph
token we don't hold).

## Deferred / Tech Debt

- Nothing deferred from Stream A's own scope. All A-1…A-5 subtasks implemented,
  frozen suite unweakened.
- Devops artifact `deploys/2026-09-09-tpl-011-video-upload-body-limit` (nginx
  `client_max_body_size`, and the R3-noted `proxy_read_timeout`) **does not exist
  in this worktree's `.claude-workspace/deploys/`** as of this handoff — per my
  brief, this is a deploy precondition owned by devops, not investigated further
  here. `proxy_read_timeout` value: **unknown**, not chased.
- The 12-line upload-fetch duplication across `ImageUploader` /
  `CampaignImageUploader` / `VideoUploader` (Stream B's file) is explicitly out of
  scope per plan decision 2 — mentioned, not touched.

## Review Hand-off

- No 🔴/🟡 self-identified issues in Stream A's own diff.
- Flag for the reviewer: the `enforce-header-media.test.ts` wording-interpretation
  judgment call above (substring vs. intent reading of the acceptance bullet) —
  worth a second look given it diverges from a literal reading of the plan's test
  list.
- Flag for the orchestrator: the A-0 commit-authorship mix-up (`f71dfb3` titled
  "Stream B" but containing both streams' frozen tests) — informational, not a
  defect, but worth knowing before trusting commit-message authorship in a shared
  worktree.
- I-1 (integration wiring walk) and I-2 (post-deploy verify) are react-frontend-dev
  / release-runbook territory per the plan's task ownership — not run here.
