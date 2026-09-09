# Flow: WA Templates — Create/Edit sheet, Video header (TPL-011)

Confirmed 2026-09-09 (dev, run `tests/2026-09-09-tpl-011-video-header-ui.md`).

## Reach

Real nav: login (recipe A) → click "WA 範本" sidebar link (`a[href="/dashboard/wa-templates"]`) →
`/dashboard/wa-templates` → click "建立範本" (Create Template, zh-HK) to open the sheet. Editing an
existing row: click the "編輯" button in that row.

No deep link needed or used — the sheet is a client-side dialog over the list route, not a separate URL.

## States and selectors

The form has no stable testids for most fields (plain `<select>`/`<input>`, no `data-testid`, no `id`,
no `name`). Use structural selectors — the Header section is the only `<fieldset>` in the dialog, so
`fieldset select` / `fieldset input[type=file]` are unambiguous.

| state | trigger | assertions |
|---|---|---|
| Header select | dialog open | `fieldset select` options: `none` / `text` / `image` / `video` (values), labels "None"/"Text"/"Image"/"Video" — plain English literals, not i18n'd |
| Video empty | `fieldset select` = `video` | `[data-testid="video-header-hint"]` visible (zh-HK: "MP4 或 3GP，最大 16MB，H.264 影片配 AAC 音訊（或無音訊）。..."); `fieldset input[type=file]` present, hidden, `accept="video/mp4,video/3gpp"`; uploader button text = "產生" (common.generate); no `<video>` element; no `[data-testid="image-header-hint"]` |
| Video: invalid file picked | upload a non-video file via `fieldset input[type=file]` | client-side only, **zero** network requests to `/api/dashboard/upload`; error text `Invalid file type: <mime>. Allowed: MP4, 3GP.` — deliberately narrower than the server's bucket-wide list (see `video-uploader-helpers.ts` doc comment / Stream B review-fix 🟡-1); size-over-16MB pre-check message mirrors the server exactly: `File exceeds 16MB limit.` |
| Video: valid upload | upload a `video/mp4` or `video/3gpp` file ≤16MB | `POST /api/dashboard/upload?bucket=wa-template-media` → 200 `{url}`, url ends `.mp4`/`.3gp`; `<video src preload=metadata muted controls>` renders 80×80; uploader button text becomes "重新產生" (regenerate); remove (✕) button appears top-right of the preview, 18×18px (below WCAG 24px minimum — inherited from `ImageUploader`'s identical markup, pre-existing pattern) |
| Submit | fill Name + Body, click "Create"/"Update" | `POST /api/dashboard/wa-templates` (create) or `PATCH .../{id}` (edit); row is saved even on a provider error (status becomes/stays `draft`); stored `components[0] = {type:"HEADER",format:"VIDEO",example:{header_handle:[url]}}` — exact IMAGE-shape parity with `format` swapped |
| Submit outcome on DEV | Kapso media-ingest call | DEV's Kapso key 404s with `{"error":"WhatsApp configuration not found"}` regardless of payload (same as the TPL-004/A-6 probe) — shown verbatim as the dialog error banner; **not** a mime/delivery rejection, so it does not confirm or refute Kapso's video support (R1 stays open until prod I-2) |
| Reopen (edit) | click "編輯" on a VIDEO-header row | `fieldset select.value === "video"`; `<video src>` equals the stored URL exactly |
| Type switch | change `fieldset select` away from Video (or Image) and back | the media URL is cleared **every** time the type changes (`applyWaTemplateFormChange`): no `<img>`/`<video>` element renders, uploader button reverts to "產生" (generate, not regenerate) |

## Other uploader buckets touched by this flow's regression checks

- `campaign-images`: no UI path reachable in this DEV tenant — the create-campaign dialog never offers
  `form.type === 'welcome'`, the only type that renders `CampaignImageUploader`. Verify via a direct
  authenticated `POST /api/dashboard/upload?bucket=campaign-images` instead (same session cookies).
- `tenant-assets`: UI lives at `/dashboard/setup` (`TenantLogoSection`) — **blocked on DEV** by an
  unrelated migration gap (`environments.md`: migration 058 missing, `restaurants.redirect_number`).
  Verify via the same direct-`curl`-with-session-cookies approach until that migration lands on DEV.

## Known non-blocking findings (2026-09-09)

- Video preview remove button (`button.absolute.-top-2`, shared with `ImageUploader`) is 18×18px,
  below the WCAG 2.5.8 24×24px minimum, at both breakpoints. Pre-existing pattern, not introduced by
  this flow — proposed as a `layout-baseline.md` entry pending a human decision, not fixed here.
- The list page's header action-button row (`從 Meta 同步` / `建立範本`) overflows its immediate flex
  parent by 11px on mobile — pre-existing, outside this flow's touched files.
