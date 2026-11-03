# Testid Registry

Selectors below are written **only** after a passing interaction confirms them. Empty until
the first real run.

| screen | element | selector | confirmed by (run/date) |
|--------|---------|----------|--------------------------|
| `/dashboard/members/import?step=csv` | upload-csv step root | `[data-step="upload-csv"]` | 2026-08-28 wonb-018-019-ui-verification |
| `/dashboard/members/import?step=csv` | CSV format help block (title + 5 lines + download button) | `[data-section="csv-help"]` | 2026-08-28 wonb-018-019-ui-verification |
| `/dashboard/members/import?step=csv` | "Download CSV template" button | `[data-action="download-template"]` | 2026-08-28 wonb-018-019-ui-verification |
| `/dashboard/members/import?step=csv` | "Choose CSV file" picker button | `[data-action="pick-csv"]` | 2026-08-28 wonb-018-019-ui-verification |
| `/dashboard/members/import?step=csv` | wizard Next button | `[data-action="next"]` | 2026-08-28 wonb-018-019-ui-verification |
| `/dashboard/members/import?step=csv` | parse-rejections panel (visible only when rows were rejected) | `[data-section="csv-parse-rejections"]` | 2026-08-28 wonb-018-019-ui-verification |
| `/dashboard/members/import?step=csv` | one rejection row | `li[data-reject-reason][data-reject-line]` | 2026-08-28 wonb-018-019-ui-verification |
| `/dashboard/members/import?step=csv` | accepted row count | `[data-info="row-count"]` | 2026-08-28 wonb-018-019-ui-verification |
| `/dashboard/members/import?step=csv` | tags-found count | `[data-info="tags-found"]` | 2026-08-28 wonb-018-019-ui-verification |
| `/dashboard/wa-templates` (Create/Edit sheet) | Header type select (None/Text/Image/Video) — no testid, unique via its `<fieldset>` | `fieldset select` | 2026-09-09 tpl-011-video-header-ui |
| `/dashboard/wa-templates` (Create/Edit sheet) | Video header uploader's hidden file input | `fieldset input[type=file]` | 2026-09-09 tpl-011-video-header-ui |
| `/dashboard/wa-templates` (Create/Edit sheet) | Video header hint text (shown only when Header=Video) | `[data-testid="video-header-hint"]` | 2026-09-09 tpl-011-video-header-ui |
| `/dashboard/wa-templates` (Create/Edit sheet) | Image header hint text (shown only when Header=Image) | `[data-testid="image-header-hint"]` | 2026-09-09 tpl-011-video-header-ui |
| `/dashboard/wa-templates` (Create/Edit sheet) | Submit / Cancel / Close buttons — plain English literals, not i18n'd | button text `Create`/`Update`/`Cancel`/`Close` | 2026-09-09 tpl-011-video-header-ui |
| `/dashboard/integrations` (list) | name input | `[data-testid="integration-create-name-input"]` | 2026-09-10 int-001-ui-walk |
| `/dashboard/integrations` (list) | Create submit button | `[data-testid="integration-create-submit"]` | 2026-09-10 int-001-ui-walk |
| `/dashboard/integrations` (list) | create-form error (e.g. empty name) | `[data-testid="integration-create-error"]` | 2026-09-10 int-001-ui-walk |
| `/dashboard/integrations` (list) | rows container / one row link | `[data-testid="integration-rows"]` / `[data-testid="integration-row-<id>"]` | 2026-09-10 int-001-ui-walk |
| `/dashboard/integrations/[id]` (detail) | name / status / provider | `[data-testid="integration-detail-name"]` / `[data-testid="integration-detail-status"]` / `[data-testid="integration-detail-provider"]` | 2026-09-10 int-001-ui-walk |
| `/dashboard/integrations/[id]` (detail) | tabs | Radix `TabsTrigger` text `設定`/`傳送記錄`/`活動` (zh-HK; no data-testid on the triggers themselves) | 2026-09-10 int-001-ui-walk |
| `/dashboard/integrations/[id]` Settings tab | inbound card root | `[data-testid="inbound-credentials-card"]` | 2026-09-10 int-001-ui-walk |
| `/dashboard/integrations/[id]` Settings tab | webhook URL readonly field | `[data-testid="inbound-webhook-url"]` | 2026-09-10 int-001-ui-walk |
| `/dashboard/integrations/[id]` Settings tab | rotate request / confirm / confirm-button / rotating / reveal / revealed-secret / copy / reveal-done | `[data-testid="inbound-rotate-request"]` / `[data-testid="inbound-rotate-confirm"]` / `[data-testid="inbound-rotate-confirm-button"]` / `[data-testid="inbound-rotating"]` / `[data-testid="inbound-secret-reveal"]` / `[data-testid="inbound-revealed-secret"]` / `[data-testid="inbound-copy-secret"]` / `[data-testid="inbound-reveal-done"]` | 2026-09-10 int-001-ui-walk (full rotate→confirm→reveal-once→dismiss cycle driven; secret confirmed cleared from the DOM after dismiss) |
| `/dashboard/integrations/[id]` Deliveries tab | admin-only / settings-unavailable text (also renders here when `GET .../settings` fails even for an actual admin — see flow note) | `[data-testid="deliveries-admin-only"]` | 2026-09-10 int-001-ui-walk |
| `/dashboard/integrations/[id]` Activity tab | activity card, load-failed text | `[data-testid="activity-log-card"]` / `[data-testid="activity-log-error"]` | 2026-09-10 int-001-ui-walk |
| `/dashboard/members` | page-size select / first / prev / next / last | `[data-testid="members-page-size-select"]` / `members-pagination-first` / `-prev` / `-next` / `-last` | 2026-10-07 mem-001 (mocked-API walk) |
| `/dashboard/members` | "No tag" filter chip, per-row quality badge | `[data-testid="members-tag-filter-no-tag"]` / `[data-testid="members-row-<id>-quality"]` | 2026-10-07 mem-001 (mocked-API walk) |
| `/dashboard/members` (detail panel) | contact quality evidence root / verdict sentence / per-message row / degrade line / badge | `[data-testid="member-quality-evidence"]` / `member-quality-verdict` / `member-quality-message-<id>` / `member-quality-evidence-unavailable` / `member-quality-evidence-badge` | 2026-10-07 mem-001b (mocked-API walk) |
| `/admin/template-reviews` (detail panel) | detail loading / detail error | `[data-testid="template-review-detail-loading"]` / `[data-testid="template-review-detail-error"]` | 2026-11-03 waq-011-detail (PR #174) |
| `/admin/template-reviews` (detail panel) | current-template preview bubble | `[data-testid="template-review-preview"]` | 2026-11-03 waq-011-detail (PR #174) |
| `/admin/template-reviews` (detail panel) | campaign card (per campaign id) / no-campaigns empty state | `[data-testid="template-review-campaign-<id>"]` / `[data-testid="template-review-campaigns-empty"]` | 2026-11-03 waq-011-detail (PR #174) |
| `/admin/template-reviews` (detail panel) | submitted content | `[data-testid="template-review-submitted-content"]` | 2026-11-03 waq-011-detail (PR #174) |
| `/admin/template-reviews` (detail panel) | template-could-not-be-loaded notice / campaigns-error notice | `[data-testid="template-review-template-missing"]` / `[data-testid="template-review-campaigns-error"]` | 2026-11-03 waq-011-detail (PR #174) |
| `/admin/template-reviews` (detail panel) | off-allowlist media header (IMAGE/VIDEO/DOCUMENT URL as text, no href) | `[data-testid="template-review-preview-media-external"]` | 2026-11-03 waq-011-detail (PR #174) |
| `/dashboard/campaigns` Create/Edit sheet | coupon notice: no discount, message only (marketing_only) | `[data-testid="campaign-coupon-no-discount-alert"]` | 2026-11-03 camp-expiry-001 (PR #173) |
| `/dashboard/campaigns` Create/Edit sheet | coupon notice: message needs a coupon, Send will be refused (blocked) | `[data-testid="campaign-coupon-blocked-alert"]` | 2026-11-03 camp-expiry-001 (PR #173) |
| `/dashboard/campaigns` Create/Edit sheet | coupon notice: welcome campaign requires a discount | `[data-testid="campaign-coupon-welcome-required-alert"]` | 2026-11-03 camp-expiry-001 (PR #173) |
| `/dashboard/campaigns` Create/Edit sheet | coupon check pending while the selected template loads | `[data-testid="campaign-coupon-mode-checking"]` | 2026-11-03 camp-expiry-001 (PR #173) |
| `/dashboard/campaigns` Create/Edit sheet | coupon check unavailable (template load failed) | `[data-testid="campaign-coupon-mode-error"]` | 2026-11-03 camp-expiry-001 (PR #173) |
