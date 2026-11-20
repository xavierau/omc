# Flow: template review UI + send feedback (issue #102, PRs #108/#109)

Status: not yet run — blocked on credentials, see .claude-workspace/tests/ latest report.

## Steps — tenant side

1. wa-templates page (as tenantAdmin) → find a MARKETING template.
2. Observe "Submit for review" action is present on MARKETING templates.
3. Campaign card / guardrail banner for a campaign referencing an unreviewed/rejected
   template → observe Send is disabled with an explanation, OR a visible blocked reason is
   shown — never a silent success.

**Boundary**: do NOT click Send/execute on any campaign targeting real members. Only observe
existing disabled/blocked state.

## Steps — admin side

1. Navigate to `/admin/template-reviews` (as platformAdmin).
2. Confirm it is reachable from the admin sidebar (real navigation, not deep-link only, per
   new-feature verification rule).
3. Confirm the review queue UI renders: pending list, approve/reject controls visible.

**Boundary**: do NOT approve/reject/submit review state for real tenants' templates. Only
interact with the test tenant's own data if exercising the action end-to-end.

## User / role

Tenant side: `tenantAdmin`. Admin side: `platformAdmin` (role/login surface TBD — see
login-recipes.md).
