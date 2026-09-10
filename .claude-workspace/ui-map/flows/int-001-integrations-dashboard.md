# Flow: INT-001 Integrations dashboard (WI-9/WI-10)

Status: partially confirmed 2026-09-10 (`tests/2026-09-10-int-001-ui-walk.md`). Blocked past the
Inbound credentials card by a DEV Supabase PostgREST schema-cache gap — see `environments.md`'s
2026-09-10 note. Re-run once that's reloaded; this file will need its "blocked" sections replaced
with confirmed steps at that point.

## Entry point

Sidebar → **整合** (Integrations, `Plug` icon) → `/dashboard/integrations`. Confirmed reachable via
real navigation, not deep-link only.

## Confirmed steps — list page

1. Empty state: "尚未有整合" + helper line, when the tenant has zero integrations.
2. Create: fill `integration-create-name-input`, click `integration-create-submit` → `POST
   /api/dashboard/pos-integrations` (201) → new row appears in `integration-rows` immediately, no
   reload needed.
3. Rejected: empty name → inline `integration-create-error` "請輸入整合名稱。", nothing submitted.
4. Row link → `/dashboard/integrations/[id]`.

## Confirmed steps — detail page, Settings tab, Inbound credentials card

1. Card renders from the pre-existing (non-INT-001) `GET .../pos-integrations/[id]` — works
   regardless of the schema-cache gap below.
2. Rotate: click `inbound-rotate-request` → confirm panel (`inbound-rotate-confirm`) with the
   "update the partner side too" warning → click `inbound-rotate-confirm-button` → transient
   `inbound-rotating` → `inbound-secret-reveal` panel with the raw new secret in
   `inbound-revealed-secret` and the "copy it now, you won't see it again" copy → last4 badge
   updates to match → click `inbound-reveal-done` → panel closes and the raw secret is confirmed
   **absent from `document.body.innerText`** afterward (never redisplayed).

## BLOCKED — Settings tab, Welcome template / Consent attestation / Outbound webhook cards

**Not reachable this run.** `GET /api/dashboard/pos-integrations/[id]/settings` 500s
(`integration-settings-repository.ts`'s `findIntegrationSettingsById` throws `Could not find the
table 'public.integration_settings' in the schema cache` — a DEV PostgREST schema-cache gap, see
`environments.md`). Because `[id]/page.tsx` guards all three cards on `isAdmin && settings`, all
three vanish **silently** — no error text, no retry affordance, nothing — for an actual tenant
admin. This is a confirmed frontend bug independent of the DEV-only root cause: any real-world
settings-fetch failure (transient DB error, etc.) produces the same silent void in prod. Recommend
an explicit error/retry state for this branch, matching what `error` already does for the base
integration fetch two lines above it in the same component.

None of the following could be exercised this run: Save URL (success / no-PII-ack warning /
invalid-URL rejected incl. `url_private_address`), secret PUT + swap-warning (incl.
`secret_too_short`), PII ack + Enabled gating, Send test event, welcome-template Off/Tenant-default
save + warnings/rejections, consent-attestation save.

## BLOCKED (misleading copy) — Deliveries tab

Same root cause. `[id]/page.tsx` renders `deliveries-admin-only` ("只有租戶管理員可以查看及管理這些設定。"
— "Only tenant admins can view and manage these settings") for **any** `!(isAdmin && settings)`
case, including an actual admin whose settings fetch simply failed. **This is factually wrong for
this user** and should be a separate confirmed finding, not folded into the silent-card issue above
— telling an authorized admin they lack permission when they don't is actively misleading, worse
than showing nothing.

## Partially confirmed — Activity tab

Only gated on `isAdmin` (not `settings`), so it DID render this run: `活動記錄` heading +
`無法載入活動記錄。` visible error text when `GET .../activity` 500s (same schema-cache cause). Unlike
Settings/Deliveries, this is the CORRECT pattern — a real, visible, non-misleading error state. Not
yet confirmed: the actual success-path rendering (rows, consent actions, welcome outcome text,
phone-last-4) once the schema cache is fixed.

## BLOCKED — Paused banner, Resume, Retry, Send-test-event → delivery-log link round trip

Not reachable — all depend on `settings` loading successfully.

## Layout / visual notes (see full report for detail)

- Desktop 1440x900: clean. Two `row-misaligned` warnings are heuristic false positives (sidebar-vs-
  main "row" comparison; a data-derived 8px spread on the create-form row that reads fine
  visually) — not confirmed defects.
- Mobile 390x844: the readonly `inbound-webhook-url` input clips its value with **no ellipsis** —
  confirmed visually (screenshot), not just heuristic. Functionally mitigated by the adjacent
  `inbound-copy-url` button (user never needs to read the full value), so scored **warning**, not
  blocking. The `返回整合列表` back-link's touch target is ~84x17px (below the 24px minimum) — minor.

## User / role

`tenantAdmin` (role `admin` in `user_tenants`) — see `env-policy.md`'s 2026-09-10 entry
(`ui-test-int001@example.com`). Staff-role view of this area (base info visible, all admin-only
cards/tabs hidden) not exercised this run — would need a second throwaway `staff` user.
