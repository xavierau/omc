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
