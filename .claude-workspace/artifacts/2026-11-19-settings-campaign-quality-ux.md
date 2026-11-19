---
type: artifact
id: 2026-11-19-settings-campaign-quality-ux
status: approved (owner 2026-11-19: "go with defaults")
related: [CAMP-016, MEM-001, MEM-002]
design: .claude-workspace/artifacts/designs/2026-11-19-settings-campaign-quality.pen
png: .claude-workspace/artifacts/designs/2026-11-19-settings-campaign-quality-png/
---

# Settings regroup + campaign audience-quality defaults — UX spec

## Owner decisions (2026-11-19, all defaults)
- D1 Layout: sub-nav on desktop, index → group page on phone, one URL per group.
- D2 Rating thresholds: read-only in this slice.
- D3 Keep the "Red and Yellow" skip level.
- D4 Members-table badge tooltip reuses the four colour meanings.

## Why
- `/dashboard/setup` stacks 8 sections in one column (logo, contact redirect, auto reply, booking, AI agent, welcome + QR, receipt template, flagged receipts). Owner: "way too long".
- Campaigns should skip low-quality contacts and filter by last visit, with tenant defaults in Settings.
- Owner (2026-11-19): every quality colour needs a visible explanation.

Surface mode: **Operate** (restaurant owner/admin, low frequency, must be self-explanatory).

## Screens (in the .pen)
| Frame | Node | PNG |
|---|---|---|
| Settings — Campaigns (desktop 1440) | `d0Xqe` | `d0Xqe.png` |
| Campaign form — Audience (sheet 560) | `P1VcQf` | `P1VcQf.png` |
| Phone — Settings index (390) | `H1JfS` | `H1JfS.png` |
| Phone — Campaigns group (390) | `Zu7Bp` | `Zu7Bp.png` |

## Layout
- **Desktop/tablet ≥ md:** page header, then a 232px settings sub-nav + one group's content. Only the selected group renders.
- **Phone:** the sub-nav becomes an index list (drill-down); a group page has a "‹ Settings" back link.
- Each group has its own URL: `/dashboard/setup/<group>`; `/dashboard/setup` redirects to `profile` on desktop and shows the index on phone. The sidebar item stays "Settings".
- Groups (label · sublabel · existing sections it holds):
  1. Restaurant profile · Logo · `TenantLogoSection`
  2. Customer messages · Contact redirect, auto reply · `ContactRedirectSection`, `FallbackReplySection`
  3. Bookings & AI agent · Admins only · `BookingSettingsSection`, `AgentSettingsSection` (group hidden for non-admins, as today)
  4. **Campaigns** (New) · Audience quality, win-back · new
  5. Join QR & welcome · Welcome message, QR code · `WelcomeSetupForm`, `QrGenerator`
  6. Receipts · Template, flagged receipts · `ReceiptTemplateSection`, `FlaggedReceiptsPanel`; nav shows an "N flagged" pill when N > 0
- Existing sections move unchanged (no behaviour change; their own Save buttons stay).

## Campaigns group
### Card: Audience quality
- Distribution: "N active members" + "Last 90 days", stacked bar (Green/Yellow/Red/No data), and a **legend with a one-line meaning under each colour** (always visible, not a tooltip):
  - Green — "90% or more of messages delivered."
  - Yellow — "60% to under 90% delivered. Some messages fail." (zh-HK "60% 至低於 90% 送達，部分訊息失敗。"; r3: "60–89%" left 89.x% in no band)
  - Red — "Under 60% delivered, or Meta says the number can't receive WhatsApp."
  - No data — "No messages sent yet, e.g. new members. Always included."
  - The percentages come from the configured thresholds (today the constants in `src/domain/value-objects/contact-quality.ts`), never hard-coded copy.
- Toggle **Skip low-quality contacts** (default ON for new tenants and backfilled tenants).
- When ON: **Which contacts to skip** segmented control: `Red only` (Recommended, default) | `Red and Yellow`. Impact note: "Today this skips {n} members. Members with no data are always included, so new members still get their first message." When OFF: the sub-row is hidden.
### Card: Win-back
- **Lapsed after** [30] days. Used by win-back campaigns and the campaign form's Last visit filter. Integer 1–365.
### Card: Rating thresholds (collapsed, "Admins only")
- Summary line shows the thresholds in use. See Decide 2: read-only in this slice.
### Save row
- "Changes apply to campaigns created after you save." · Discard · Save changes. One save for the whole group.

## Campaign form (sheet) — Audience section
- Send to: All members | Selected members | Tags (existing behaviour).
- Filters box:
  - **Only lapsed customers** toggle + "No visit for [N] days or more" (N pre-filled from Settings). Combines with any audience, including Tags (fixes tag precedence over win-back in `resolve-campaign-members.ts`).
  - **Skip low-quality contacts** toggle (pre-filled from Settings) + **colour key**: Green 90%+ delivered · Yellow 60% to under 90% · Red under 60% or can't receive · No data new; each row shows "Receives" or "Skipped" for the current skip level. Footer: "Default from Settings · Red only · Change" (link to `/dashboard/setup/campaigns`).
- Recipient summary: audience count → after last-visit filter → "Skipped: Red contacts −n" → **Will receive**. Footnote: consent and Meta daily limits are re-checked at send time.
- The summary numbers and the send must use the same server-side resolution (count/send parity).

## Feedback states
| Action / surface | Loading | Empty / edge | Error | Success |
|---|---|---|---|---|
| Distribution load | skeleton bar + legend | 0 active members → "No active members yet" and impact note hidden | "Couldn't load member quality" + Retry; toggles stay usable | — |
| Save Campaigns group | button "Saving…", disabled | Save disabled until something changes | inline error under the save row, values kept | "Saved" inline note (matches existing sections) |
| Lapsed days input | — | out of range → inline "Enter 1–365 days" and Save disabled | — | — |
| Campaign form summary | counts show "…" while recalculating | 0 will receive → warning "No one will receive this campaign" and Create stays enabled (draft) | "Couldn't calculate recipients" + Retry | — |
| Non-admin on Campaigns group | thresholds card shows read-only summary, no chevron | — | — | — |

## Test ids (append to `ui-map/testid-registry.md` when built)
`settings-nav-<group>` · `settings-index-row-<group>` · `settings-back` · `settings-campaigns-quality-bar` · `settings-campaigns-quality-legend-<green|yellow|red|nodata>` · `settings-campaigns-quality-error` · `settings-campaigns-quality-empty` · `settings-campaigns-skip-toggle` · `settings-campaigns-skip-level-<red|red-yellow>` · `settings-campaigns-skip-impact` · `settings-campaigns-lapsed-days` · `settings-campaigns-lapsed-days-error` · `settings-campaigns-thresholds` · `settings-campaigns-save` · `settings-campaigns-saved` · `settings-campaigns-save-error` · `campaign-audience-lapsed-toggle` · `campaign-audience-lapsed-days` · `campaign-audience-quality-toggle` · `campaign-audience-quality-key` · `campaign-audience-summary` · `campaign-audience-summary-will-receive` · `campaign-audience-summary-error` · `campaign-audience-zero-warning`

## Tokens
- Uses the app's existing shadcn tokens (`globals.css`): background, card, border, muted, muted-foreground, primary.
- Quality colours reuse the member badge tones (`member-quality-badge.tsx`): green-700/green-500·15%, yellow-700/yellow-500·15%, red-700/red-500·15%, muted. The bar uses the solid 500/600 shades.
- No new tokens.

## Hand-off notes
- Storage: two new `tenant_campaign_settings` columns, e.g. `skip_contact_quality` (`off|red|red_yellow`, default `red`) and `lapsed_after_days` (int, default 30), plus the seed trigger/backfill pattern from 078. Today that table is only editable through the platform-admin API, so this needs a tenant route with role checks.
- Members table: reuse the same four meaning strings in the quality badge tooltip so the colours read the same everywhere (currently it shows only "{rate}% delivered").
- i18n: en + zh-HK for every new string.
- DESIGN.md / PRODUCT.md: **missing** in this repo. The mockup follows `globals.css` and the existing sections. Not created in this pass (POC); flagged to the owner.
- `harness.md` / layout scaffold: not run (no DESIGN.md stub created).
- Detector: not run. There is no HTML prototype; the .pen is the reference.
- Deferred: editable thresholds (Decide 2), moving Flagged receipts out of Settings, engagement score (MEM-002/003).
