---
id: artifacts/2026-11-27-sec-next-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-28
status: active
supersedes: null
superseded_by: null
item: SEC-NEXT
state: done
brief: inline (SEC-NEXT, BOOK-014 W0; rulings r1 corrected AC-2, r2 merge develop + finish)
base: 2f922d5b25e7655adb317c80bf1fa8cc6f72313f (merged origin/develop 28835faf after the fix commit)
head: see the PR (fix commit d7423c59, merge 6df1f351; this file is in the records commit after them)
branch: fix/sec-next-16-4-6
pushed: true
stage: poc
suite_changed: "no"
gate: {result: pass, at: 2026-11-28T00:02Z}
next: {owner: main, action: "review and merge the PR into develop; release must reach production before any live Stripe key (R66); build off-box"}
blockers: []
refs: [kanban:SEC-NEXT, kanban:BOOK-014, threats/2026-11-27-book-014-booking-deposits]
related: []
---
ac:
  AC-1: {result: pass, evidence: "evidence/2026-11-27-sec-next/ac1-audit.log: next@16.4.6 installed; `npm audit --omit=dev` prints 'next None' (base listed next critical with GHSA-vcvr-r3jv-pc5j, GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr among 17 advisories). Remaining critical is proxy-addr, out of scope."}
  AC-2: {result: pass, evidence: "Corrected check (ruling r1): evidence/2026-11-27-sec-next/ac2-gates.log, tsc + next build + vitest under the heavy lock, exit 0; vitest 733 files passed / 17 skipped, 8618 tests passed / 140 skipped / 2 todo. ac2-eslint-compare.log: `npx eslint src` 36 errors / 13 warnings at base 2f922d5b (next + eslint-config-next 16.3.4) and on the branch (16.4.6); eslint-base.txt == eslint-branch.txt (same file:line rule set). ac2-r0-original-chain.log is the original brief chain stopping at those 36 pre-existing errors."}
  AC-3: {result: pass, evidence: "evidence/2026-11-27-sec-next/ac3-*: `next start -p 3070` (16.4.6, Ready in 532ms). Headless Chromium: /b/sec-next-probe-token 200 with the invalid-link page ('此訂座連結無效'), /dashboard 307 → /login 200; 0 console errors, 0 failed requests, 0 responses >= 400 (ac3-browser.json, two screenshots)."}
  AC-4: {result: pass, evidence: "Branch pushed with `rtk proxy git push`, ls-remote SHA == HEAD; PR into develop open, not merged (URL in kanban SEC-NEXT pr field and the return block)."}
decisions:
  - "Pins kept exact (16.4.6), as the repo had them for both packages."
  - "Lockfile churn accepted as next's own closure: @next/*, eslint-config-next, @next/eslint-plugin-next, sharp 0.35.4 -> 0.35.5 (next's optional dep ^0.35.5) and its @img/* binaries, sharp's nested semver; npm also wrote package.json's existing engines block into the lockfile root."
  - "AC-3 used a scratchpad playwright-core with the cached headless shell because the chrome-devtools MCP browser was held by another session; no repo dependency added."
failed:
  - tried: "brief AC-2 chain with `npx eslint src`"
    why: "36 eslint errors already on develop 2f922d5b stop the chain before build and vitest"
    evidence: "evidence/2026-11-27-sec-next/ac2-r0-original-chain.log"
    replaced_by: "ruling r1 chain plus the base-vs-branch eslint count"
invariants:
  - "No dependency other than next and eslint-config-next changed in package.json"
  - "No src/ or next.config.ts change"
unverified:
  - "Production behaviour of 16.4.6 under `node .next/standalone/server.js` (the repo builds output: standalone; the local walk used `next start`, which warns about that)"
  - "CI result on the PR at the time of writing (read with gh pr checks)"
review_focus:
  - "package-lock.json: confirm only next's closure moved"
