# BOOK-001 integration seam bugs (I1 walk and PR #178 review round F1)

Date: 2026-11-12. Branch `feature/book-001` (PR #178). Six bugs found where independently built
slices (W1 booking core, W2 inbound routing, W3 campaigns/templates/crons) met. Three were
fixed during the I1 integration walk, three in review round F1 (cross-model review S-1/S-2,
`/code-review` #1). Each section: problem, root cause, fix, prevention.

## 1. Settings save failed on a hidden invalid external URL (87eb031f, I1)

- **Problem:** an admin typed `http://…` under External link, switched to Simple and pressed
  Save. The PUT came back 400 on `externalUrl`, a field Simple does not render, so Simple
  could never be saved and the admin saw no reason.
- **Root cause:** `toPayload` sent every form field whatever the mode. The server validates
  the URL whenever it is present (R14), so a draft in a hidden field failed the whole save.
- **Fix:** outside External mode the payload sends the URL only when it is a safe https URL
  (keeps the stored one, drops an invalid draft). Server validation unchanged.
- **Prevention:** a payload test per mode for every field the mode hides
  (`booking-hooks.test.ts`). Item 4 below is the same bug on other fields.

## 2. "Confirmation sent" next to "Message not delivered" (96083afe, I1)

- **Problem:** confirming a booking whose WhatsApp message failed showed the success notice
  and the not-delivered badge together. The zh-HK already-handled line also read `已已拒絕`.
- **Root cause:** `noticeFor` mapped every `done` outcome to "sent" and ignored `delivered`.
  The zh copy put `已` in the sentence while the status word already carried it.
- **Fix:** `noticeFor` returns no notice for `delivered: false`, so the badge is the only
  feedback (spec warning row). zh copy changed to `此要求{status}。`.
- **Prevention:** test the warning row of every UI Feedback States line, not just success;
  render interpolated copy with its real values in a test (`booking-hooks.test.ts`).

## 3. Full recipient numbers in Kapso skip logs (fbdec552, I1, R8)

- **Problem:** with no Kapso key or no phone number id, the client's skip log printed the
  diner's full number. The booking slice masks numbers everywhere (R8); the shared client
  did not.
- **Root cause:** the masking rule was applied in the new booking code only. The shared
  Kapso client predates it and logged `to` verbatim on its early-return paths.
- **Fix:** every client sender masks `to` (`***4567`) in its skip logs.
- **Prevention:** `client-log-masking.test.ts` checks each sender × skip reason. A PII rule
  in a threat model covers the shared code paths the feature calls, not only the new files.

## 4. Off/External save failed on a hidden invalid lifetime or party size (F1, review #1)

- **Problem:** in Simple, type `0` in a link lifetime, choose Off (or External), press Save:
  400 on `chatLinkTtlHours`, which those modes do not render. Turning booking off was
  silently blocked.
- **Root cause:** the same as item 1. Fix 87eb031f covered the URL only, not the other fields
  a mode hides.
- **Fix:** outside Simple, `toPayload` sends a lifetime or the party size only when it is
  valid (the domain's own `isTtl` / `isPartyMax`), else omits it, so the server keeps the
  saved value. In Simple the invalid value is still sent, so the field error shows.
- **Prevention:** the test runs `toPayload` output through the real server parser
  (`parseBookingSettings`) for Off and External, so any hidden field that can fail a save
  is caught.

## 5. Book now on welcome campaigns broke every welcome send (F2, review S-2)

- **Problem:** the campaign API accepted Book now on a `welcome` campaign. The partner-API
  welcome send (`process-welcome-send-job.ts`) passes only a coupon code, so the Book now
  button would go out unfilled. Meta refuses that payload, so every welcome for that tenant
  would fail.
- **Root cause:** only the broadcast path (`execute-campaign.ts`) mints a booking token. The
  guard checked toggle vs template but not the campaign type, and nothing at the send layer
  stopped a Book now template without a token.
- **Fix:**
  - The guard refuses Book now on welcome (POST, and PATCH that changes the type, toggle or
    template). The form shows a notice instead of the toggle, and the request body never
    sends Book now on for welcome.
  - `sendWhatsAppTemplateMessage` refuses any Book now template without a token
    (`book_now_token_missing`) before the network, whatever the caller.
- **Prevention:** a new per-recipient value on a shared sender needs a list of every caller
  of that sender. That list is now in the F1 handoff. The send-layer refusal makes a missed
  caller fail typed and loud instead of at Meta.

## 6. Book now button found by URL equality with NEXT_PUBLIC_APP_URL (F3, review S-1)

- **Problem:** the sender found the Book now button by `url === NEXT_PUBLIC_APP_URL +
  '/b/{{1}}'`. The dashboard bakes that URL into the template when it is built; the campaign
  worker reads its own env at send time. If they differed (unset, http vs https, a moved
  domain), the Book now button counted as a coupon button. It then got the coupon code (the
  diner landed on "unknown link"), or a coupon-less campaign was blocked as "coupon config
  missing".
- **Root cause:** identity depended on two processes agreeing on an env value that only one
  of them (the bundle) had always needed.
- **Fix:** a button is Book now when its https URL's path ends exactly with `/b/{{1}}`, on
  any host (`isBookNowButtonUrl`). This applies on the template form and the send side. The
  `appUrl` threading this PR had added to coupon/QR predicates is removed.
- **Prevention:** never identify stored data by comparing it with live config. Identify it
  by a property of the data itself. The test runs the send with the env unset and with a
  different host.
