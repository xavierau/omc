# Templates stuck in `draft` — Meta rejection swallowed (#64, TPL-003)

## Problem

WhatsApp templates created via the dashboard never left `draft`. Meta rejected each
submission with HTTP 400, code 100, subcode 2388043:

```
errorUserTitle: "Message template 'components' param is missing expected field(s)"
errorUserMsg:   "component of type BODY is missing expected field(s) (example)"
```

The app swallowed the error and still returned **HTTP 201**, so the dashboard reported
success while the row silently stayed a draft forever. Sync could not heal it either —
`syncTemplateStatus` only considers rows that already have a `metaTemplateId` and a
status of `pending`/`approved`/`paused`, so drafts are invisible to it. There is no
Meta `message_template_status_update` webhook; status is only ever pulled manually.

## Root cause

Three failures stacked, and each one hid the next:

1. **No example injection.** Meta requires `example.body_text_named_params` for every
   `{{named}}` param in a NAMED-format template. The create and edit paths submitted raw
   components and never injected them.
2. **The error was swallowed.** `createMetaTemplate` caught everything, logged a
   `console.warn`, and returned `null`. The port contract itself
   (`Promise<CreateTemplateResult | null>`) made propagation *structurally impossible* —
   there was nowhere for a reason to live.
3. **The route lied.** A failed submission returned 201 with a `warning` field, and the
   dialog only checked `res.ok`.

The deeper enabler: both use cases cast components through
`as Array<{ type: string; [k: string]: unknown }>` before submitting. That cast is why a
shape mismatch this basic reached production without a single type error.

## Investigation notes (the part worth remembering)

**The issue's prescribed fix referenced code that did not exist.** #64 said to wire in an
existing `prepareTemplateComponents` helper and drop an inline duplicate. That helper had
never existed — `git log --all -S 'prepareTemplateComponents'` returned zero hits across
every branch and commit; `scripts/resubmit-wa-template.ts` had never existed either. The
inline `injectNamedParamExamples` was not a duplicate of anything; it was the *only*
injection code in the repo, and contrary to the issue it did **not** ingest image headers.
The work was therefore "write the helper", not "wire up the helper".

The issue's production specifics could not be verified at all: `.env.local` points at a
dev/staging database containing 3 restaurants, none of them 釧 Kushiro, with no
`offer_promotion` row and zero full-width braces anywhere. The code bugs were confirmed by
reading the code and reproduce against the 6 stuck drafts that *are* visible there.

## Solution

- New pure domain services `prepare-template-components` / `validate-template-components` /
  `template-media-header` — one injection point, used by create, edit **and** resubmit.
- Port contract → `TemplateSubmitResult` (Result type, following the existing `SendResult`
  precedent) so Meta's reason survives. `kapso_no_api_key` (a skip — nothing submitted) is
  kept distinct from `meta_rejected` (Meta refused) and `template_create_error` (transient).
  Only a confirmed Meta refusal brands a row.
- Honest HTTP: 422 rejected / 502 provider / 400 save-time validation. `status:'rejected'`
  + `rejection_reason` persisted. No migration — the column already existed, unused.
- Both casts deleted.

**Bug found while fixing, not reported in #64:** the edit path deleted the live Meta
template *before* re-creating it, so editing an approved template with a payload Meta
rejects silently destroyed it. Validation now runs first; a failed delete aborts.

## Not fixed — image headers

Meta only issues a template `header_handle` via the App-level Resumable Upload API
(`POST /{APP_ID}/uploads` → `{"h":"4:..."}`). This app holds only `KAPSO_API_KEY` and
reaches Meta solely through the Kapso proxy, which does not expose that endpoint; the SDK's
`media.upload({uploadStrategy:'resumable'})` posts to `{phoneNumberId}/media` and returns a
plain media id, not a handle. Image headers are therefore **blocked at save** as an interim,
and dashboard image-header creation is disabled. 4 of the 6 stuck drafts have image headers
and stay stuck — they now just fail loudly. **TPL-004** tracks the unblock.

## Prevention

- **A port that returns `T | null` cannot carry a reason.** The null was not an oversight;
  the contract made propagation impossible. When an outcome has more than one failure mode,
  the type must say so — `SendResult` was already in this repo doing it right, and copying
  it was the whole fix.
- **A cast at a boundary is where this class of bug enters.** `as Array<{ type: string; ... }>`
  silenced exactly the check that would have caught a malformed component shape. Type the
  helper against the port and delete the cast.
- **`??` is not `||`.** Two separate bugs here: `''` (unset WABA, as really stored) is not
  nullish, so `?? autoResolve(...)` never fell through and the draft was never submitted;
  and `[]` is neither nullish nor falsy, so neither operator falls through an empty handle
  list. Check by length when "empty" and "absent" must mean the same thing.
- **Not-submitted and rejected must not look alike.** A skip (no API key) and a transient
  network error must never be recorded as a Meta content rejection — an operator would go
  hunting for a content problem that does not exist.
- **Verify an issue's claims against the repo before planning from them.** The most
  expensive assumption here would have been trusting that the named helper existed.
- **Status is an authorization input, not a label.** `isTemplateSendable` is just
  `status === 'approved'`, and it gates campaign sends. An intermediate version of this fix
  preserved `approved` while local components diverged from Meta — which would have let
  campaigns send against a stale definition. Both cross-model reviewers caught it
  independently. Before preserving a status, ask what reads it.
