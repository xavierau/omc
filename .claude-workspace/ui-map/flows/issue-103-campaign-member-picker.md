# Flow: campaign member picker server-side search (issue #103, PR #107)

Status: not yet run — blocked on credentials, see .claude-workspace/tests/ latest report.

## Steps

1. Dashboard → Campaigns → campaign form → Target audience → "Selected" → member search box.
2. Type a search term into the member search box.

## Assertions

- Typing triggers a debounced server-side request containing `?search=` (verify via network
  request inspection, not just UI behavior).
- Results are not capped to the first 20 members (i.e. paging/search actually reaches beyond
  page 1).
- A "Showing X of Y" count renders and updates.
- The Select-all button reads plain "Select all" when everything is loaded, and
  "Select all N loaded" when more pages remain unloaded.

## User / role

`tenantAdmin` (or `defaultUser` if no distinct admin role) — own test tenant only, per
env-policy.md prod allowlist.
