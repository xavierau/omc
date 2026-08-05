# Phone-button templates unsubmittable: `phone_number` never sent (issue #97)

**Date**: 2026-08-05
**Issue**: [#97](https://github.com/xavierau/omc/issues/97)
**Reported from**: production `app.ohmyclient.io`, 2026-08-05 03:13 UTC
**Related**: TPL-003 (rejection reason surfacing), TPL-004 (media headers)

## Problem

Creating a WhatsApp template with a **Phone** button failed at Meta with
`Invalid parameter (code 100, subcode 2388050)` — a code with no indication of
which field was wrong. Every Phone-button template was unsubmittable.

The saved draft (`whatsapp_templates`, `testing_template`) stored the button as:

```json
{ "text": "+85296283521", "type": "PHONE_NUMBER" }
```

The number the admin typed sat in `text` (the label). `phoneNumber` was absent
entirely. Since the row stores the request body essentially verbatim, the value
was lost in the browser, before the POST — every server hop was innocent.

## Root cause

Four independent gaps, each of which alone would have made this loud instead of
silent:

1. **`addButton()` never seeded `phoneNumber`** (`wa-template-buttons-section.tsx`).
   The new button literal was `{ type: 'URL', text: '', url: '' }`, and
   `updateButton` only overwrites the one key it is handed — so switching the
   dropdown to `PHONE_NUMBER` neither seeded `phoneNumber` nor cleared the stale
   `url`. `TemplateButton` declares `phoneNumber: string` as required, but
   `onChange`'s value parameter is typed `unknown`, so TypeScript never checked
   the literal against the type.
2. **The payload builder dropped the key when the value was `undefined`**
   (`wa-template-form-types.ts`): `JSON.stringify` removes an undefined value, so
   the wire payload was `{ type, text }` — a phone button with no number.
3. **Nothing validated buttons anywhere in the chain.** The dialog checked only
   `name`/`body`; `validateCreateBody()` checked only that `components` is an
   array; `validateTemplateComponents()` covered media headers only.
4. **The error shown to the operator threw away Meta's explanation.**
   `describeGraphError()` built its message from `err.message` + code + subcode,
   discarding `error_user_title` / `error_user_msg` — which said exactly
   *"Button at index 1 is missing expected field(s) (phone_number)"*.

The Kapso SDK was not at fault: `toSnakeCaseDeep` maps `phoneNumber` →
`phone_number` correctly and its component schema is loose, so it faithfully
transmitted what it was given.

## Solution

- `wa-template-form-types.ts` — `createTemplateButton()` seeds every field;
  `applyTemplateButtonChange()` clears the fields that no longer apply on a type
  change; `validateWaTemplateButtons()` returns a user-facing message naming the
  offending button; the builder emits `?? ''` so a missing value stays visible on
  the wire instead of deleting the key.
- `wa-template-buttons-section.tsx` — uses both helpers, and the two bare inputs
  now carry real labels ("Button 1 label" / "Phone number, with country code"),
  which is what let the number land in the wrong box.
- `wa-template-form-dialog.tsx` — `handleSubmit` blocks on the button error
  before any request is made.
- `validate-template-components.ts` — server-side backstop shared by create,
  edit and resubmit: a `URL`/`PHONE_NUMBER` button missing its label, URL or
  number never reaches Meta. Other button types pass through untouched.
- `template-client.ts` — `describeGraphError()` now appends Meta's
  `errorUserTitle` / `errorUserMsg`, so all rejection classes (missing BODY
  example, variables at the start/end, image-header sample, WhatsApp links in
  buttons) become legible instead of a bare code.

## Prevention

- Regression tests: `wa-template-form-types.test.ts` asserts the phone number
  survives a JSON round-trip of the request body — the exact hop where it was
  lost — plus type-switch clearing and every validation branch;
  `validate-template-components.test.ts` covers the backstop;
  `template-client.test.ts` covers the Meta explanation and its fallback.
- Pattern to carry forward: **a required field on an interface is not enforced
  where the value crosses an `unknown`-typed boundary.** Construct such objects
  through a factory typed at the interface, never as an inline literal.
- Pattern to carry forward: **spreading a conditional key with a possibly
  undefined value silently deletes it at the JSON boundary.** Emit the empty
  value instead, so downstream validation can see the field is blank.
