# QR scanner area too small on mobile (SCAN-001)

## Problem

Customer feedback: the QR scanner on the dashboard scan page is too small on
phones. Staff scan customer QR codes on mobile; the highlighted scan region was
a fixed 250×250px square, with everything outside it dimmed by html5-qrcode.

## Root cause

`src/components/dashboard/qr-scanner.tsx` passed a hardcoded
`qrbox: { width: 250, height: 250 }` to `Html5Qrcode.start()`. On a ~342px-wide
viewfinder (390px phone minus page padding) the dimmed 250px box reads as a
small scanner regardless of how large the camera view is.

Key library semantics discovered during review (html5-qrcode 2.3.8):

- The "viewfinder" passed to a `qrbox` function is the **video element's
  rendered size** — width = container `clientWidth`, height = width ÷ camera
  stream aspect ratio — NOT the visible square container. Percentage sizing
  therefore shrinks below 250px on landscape (4:3 / 16:9) camera streams.
- The qrbox is evaluated **once at scanner start**; rotation does not
  recompute it.
- The old shared `QR_CONFIG` object literal was mutable state:
  `validateQrboxSize` truncates the qrbox dimensions object **in place**, so
  one start in a narrow container could permanently shrink the config for the
  session. The function form returns a fresh object per call and is immune.

## Solution (PRs #44 + #46)

- `qrbox` is now a `QrDimensionFunction` (`computeQrbox` in
  `qr-scanner-helpers.ts`): 80% of the smaller viewfinder dimension, clamped to
  the library's 50px minimum. Product decision: pure 80% (no legacy 250px
  floor), accepting the smaller box on landscape streams.
- QrScanner restarts on debounced (500ms) viewport **width** changes so
  rotation picks up fresh geometry; height-only resizes (iOS Safari chrome
  collapse on scroll) are ignored.
- Scanner start/stop pairs are serialized through a session promise chain —
  a restart can never open a second camera stream before the previous session
  fully stopped, no scanner instance is orphaned, and construction is guarded
  against post-unmount container removal.
- `QR_CONFIG.qrbox === computeQrbox` is pinned by a unit test so a
  pre-computed fixed size (`computeQrbox(250, 250)`) can't silently return.

## Prevention

- Adversarial review of the first cut caught a deterministic ref-clobbering
  bug in the naive rotation restart (async cleanup nulling the new instance's
  ref) before it shipped. Lifecycle code around async start/stop should always
  get an interleaving-trace review.
- Follow-ups filed from the same review: SCAN-002 (visible square vs decode
  region misalignment on iOS portrait — plausibly the deeper root cause of
  "scanner doesn't work" complaints) and SCAN-003 (cross-instance camera leak
  on rapid redeem/stamp toggle).
- Process note: two `git push` failures were masked by output filtering, so
  PR #44 squash-merged with only the first commit; caught by explicitly
  comparing `git ls-remote` SHAs, remainder landed as PR #46. Verify pushes by
  SHA, not by output, when a filtering proxy is active.
