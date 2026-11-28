# BOOK-014 W6b: Stripe test-mode walk (2026-11-28, final)

All ten steps ran against real Stripe test mode. W1–W10 pass. Two Stripe-side findings need a ruling
(Finding A, B below); neither blocked a step. No src change.

## How it ran
- Tree `feature/book-014-core` at 7388c35d (docs commits on top only).
- The app ran via `next dev -p 3080` (`dev-run.sh`, zh-HK; it was restarted with `WALK_LOCALE=en` for the en
  screenshots). The BullMQ workers ran via `scripts/start-worker.ts` (`worker-run.sh`), because the AI agent
  replies from the worker.
- Data: isolated local Supabase `whatsapp-crm-w4` (001..097, 0 errors) and a walk-only Redis. The seed is
  `seed-w6b.sh`: a fake tenant "W6b Deposit Kitchen" and an admin.
- WhatsApp/Kapso is faked: `wa-inbound.mjs` sends signed inbound texts, and BOOK-013's `fake-kapso.cjs`
  records every outbound message to `kapso-fake.jsonl` (/b and /p tokens scrubbed; read it with `kapso-tail.sh`).
- Stripe: platform `acct_1NvaUiBOrstacydg` (restricted `rk_test_…` key) and connected Standard test account
  `acct_1UgkeeBsmWz9nN6A` (HK, hkd), created by the app's Connect button and onboarded by the owner in a real
  browser because of a CAPTCHA. Webhooks came through `stripe listen --forward-connect-to/--forward-to` on the
  CLI's own login: 30 events delivered, all answered 200 (`stripe-listen.log`).
- Browsers: the admin pages ran in the chrome-devtools MCP. Diner pages and Checkout ran in a Playwright driver
  (`diner.mjs`, cached Chromium; Checkout fields live in Stripe iframes).
- Per-step DB rows (booking, deposit, deposit_events) and Stripe objects (session, payment intent, charge,
  refunds) are in `walk-state.log`, read back after each step from the DB and the Stripe API.

## Blockers on the way (resolved by the owner, recorded for history)
1. `stripe listen`: the CLI was logged in to another account, and the key lacked `stripecli_session_write`.
   Fixed by the owner's `stripe login` into the platform (ruling r1).
2. Connect was not signed up in test mode (`accounts.create` → "You can only create new accounts if you've
   signed up for Connect…"). The owner signed up.
3. Stripe-hosted onboarding showed an hCaptcha (`w6b-blocked-onboarding-captcha.png`). The owner completed
   onboarding (ruling r2).
4. The key lacked connected-account permissions: `checkout_session_write`, `payment_intent_read`, `charge_read`.
   W2's first attempt got 503 payment_unavailable, and the hold lapsed at once (fail closed, seats freed).
   The owner granted them (ruling r3).

## Steps

### W1 admin: Connect → Active; deposit per guest HK$100 from 2; summary; /b terms. PASS (with a note)
- Expected: Connect → Stripe onboarding → return → Active, driven by account.updated.
- Observed: `POST …/payments/connect` 200 created `acct_1UgkeeBsmWz9nN6A` (row pending) and opened onboarding.
  After the owner finished it, the chip showed 已啟用 / Active.
  - **Active came from the return page's refresh** (`GET /api/dashboard/settings/payments?refresh=1`,
    `last_webhook_at` null), not from account.updated. Stripe created `evt_1UglmVBsmWz9nN6AAhv4mIQA`
    (account.updated, 13:35:11Z), but it never reached the app: the first listener's log was block-buffered,
    so its readiness is unproven.
  - Stripe refuses to resend connected-account events ("You are not permitted to configure webhook endpoints
    on a connected account").
  - Real account.updated delivery is proven in W10 instead. No DB row was written by hand for W1.
- Deposit saved `{"mode":"per_guest","amount":100,"enabled":true,"fromPartySize":2}`. The summary reads
  "訂金每位 HK$100（2位或以上） / Deposit HK$100 per guest for 2 or more".
- The /b form shows `booking-deposit-terms` and the Stripe sentence in both languages (`booking-collection-deposit`).
- Screenshots: `w6b-w1-settings-active-deposit-zh.png`, `w6b-w1-settings-active-deposit-en.png`, `w6b-w2-b-form-deposit-zh.png`.

### W2 /b 4 guests → Checkout HK$400 → pay 4242 → /p paid; staff row; "received". PASS
- The diner sent BOOK and got the 立即訂位 /b link. 4 guests, 2026-11-29 19:00 →
  "支付訂金 HK$400 並送出" → redirect to checkout.stripe.com (2.9 s from submit in the scripted runs).
- The Checkout page shows "Deposit · W6b Deposit Kitchen · 2026-11-29 19:00 · 4 guests", HK$400.00, and the
  connected account's name. Adaptive Pricing also offers NT$ (see Finding B).
- Paid in HKD with 4242: `cs_test_a0CrhocT…` complete/paid 40000 hkd, `pi_3UglxMBsmWz9nN6A1t83eopN` succeeded.
- Webhook checkout.session.completed → 200. Deposit `paid`; events created → session_created → paid (provider);
  booking `pending`.
- /p ?return=success → `booking-pay-paid` "已收到訂金 / Deposit paid … request sent".
- Staff row: 待確認 · `booking-deposit-badge` data-state=paid "已付訂金 HK$400".
- Diner text: "W2 Diner Chan你好,我們已收到你在W6b Deposit Kitchen的訂座要求:2026-11-29 19:00,4位。…" (received).
- A second, en-UI run did the same (`W2en Diner Wong`, `pi_3UgmVuBsmWz9nN6A1DkfzbOK`).
- Screenshots: `w6b-w2-checkout-initial.png`, `w6b-w2-checkout-filled.png` (HK$400 selected), `w6b-w2-p-return.png`,
  `w6b-w2-staff-row-paid-zh.png`, `w6b-w2en-*`.

### W3 decline → refund. PASS
- Staff 拒絕 → 發送拒絕 on W2's booking → booking `declined`.
  - Refund `re_3UglxMBsmWz9nN6A1hhZBWRX` 40000 hkd **succeeded synchronously**: Stripe returns succeeded at
    once for 4242.
  - So the deposit went straight to `refunded` (events refund_requested by the user → refund_succeeded by the
    provider), with no observable refund_pending.
  - refund.updated and charge.refunded followed and changed nothing (charge.refunded logged as
    `payment.refund_event_not_ours`, per W6-fix F1).
- In Stripe: payment intent charge `refunded: true`, amount_refunded 40000.
- Decline text: "很抱歉,餐廳未能接受你在2026-11-29 19:00的訂座要求。… 你的訂金 HK$400 將會退回。"
- /p shows `booking-pay-refunded`; the staff row shows 已拒絕 · 已退款 HK$400.
- **W3b, the brief's refund_pending → refunded path, with Stripe's pending-refund test card 4000000000007726.** PASS
  - Decline → refund `re_3UgmLQBsmWz9nN6A2hgdSksD` **pending** → deposit `refund_pending`.
  - The staff badge showed 退款處理中 HK$200; /p showed refunded copy ("正在退款或已經退回").
  - charge.refunded arrived while pending and was ignored (F1, live).
  - Two minutes later refund.updated (succeeded) moved the deposit to `refunded`
    (refund_succeeded, provider, 14:13:33Z).
  - Stripe refund JSON: `stripe-refund-re_3UgmLQBsmWz9nN6A2hgdSksD.json`.
- Screenshots: `w6b-w3-staff-row-refunded-zh.png`, `w6b-w3-p-refunded-{zh,en}-390.png`, `w6b-w3b-staff-row-refund-pending-zh.png`, `w6b-w3b-p-refund-pending-390.png`.

### W4 cancel + Refund; no-show + Keep; a second action → 409. PASS
- W4a `W4 Cancel Lee` (2 guests, paid `pi_3Ugm3DBsmWz9nN6A3kCFsOvx`):
  - Staff confirm → "你的訂座已確認…".
  - Menu → 取消訂座 → the dialog's deposit choice 全數退款 → booking `cancelled`, refund `re_3Ugm3DBsmWz9nN6A3cCqKoLr`
    succeeded, deposit `refunded` (reason staff, decided_by the admin, 13:53:49Z). Cancel text sent.
  - Then POST refund → **409** `{"error":"conflict","status":"refunded"}`; POST keep → **409**.
    Stripe still lists exactly one refund.
- W4b `W4 NoShow Ho` (today 22:00, paid `pi_3Ugm3XBsmWz9nN6A0A6CqRKn`):
  - Confirm; after 22:00 HK, 標記未出席 → `no_show`.
  - The row shows "持有訂金 HK$200" with Refund/Keep; /p shows `booking-pay-held`.
  - Keep → deposit `kept`, decided_by the admin, decided_at 14:03:27Z, event kept (user). /p now shows
    `booking-pay-closed`.
  - Keep again → **409** `status: kept`; Refund → **409**. No refund in Stripe (`refunded: false`).
- Screenshots: `w6b-w4b-staff-row-no-show-held-zh.png`, `w6b-w4b-p-held-390.png`, `w6b-w4b-staff-row-kept-zh.png`, `w6b-w4b-p-kept-390.png`, `w6b-w4a-p-refunded-1200.png`.

### W5 lapse. PASS
- `W5 Lapse Wong` (3 guests) left unpaid; the day's holds showed `{"2026-11-29":3}`.
- `hold_expires_at` set 1 min into the past in the DB, then `GET /api/cron/booking-reminders` (local CRON_SECRET)
  → `{"depositsLapsed":1,"sessionsClosed":1,…}`.
- Booking and deposit `lapsed`, event lapsed (cron). The Stripe session `cs_test_a0t1xGhE…` is **expired**
  (checkout.session.expired delivered, 200).
- /p shows `booking-pay-lapsed` "訂座保留已過期 … 如已付款，款項將會全數退回". Holds are now `{}`, so the seats are released.
- No diner text: the source is chat, and the lapse text is for the AI agent only (W6a).
- While the hold was open, /p redirected to Checkout (`w6b-w5-p-while-open-redirects-to-checkout-390.png`).
- Screenshots: `w6b-w5-p-lapsed-390.png`, `w6b-w5-p-lapsed-1200.png`.

### W6 late payment after the lapse. PASS
- `W6 Late Payer`: Checkout opened and filled with 4242. While the page waited, the hold was moved into the
  past and lapsed with the cron's own RPC (`lapse_expired_booking_deposits(1, id)`) without closing the Stripe
  session. This is the race where our expire call has not reached Stripe yet. Then Pay was pressed.
- Real payment `pi_3Ugm8iBsmWz9nN6A0fh0Dsu2` → checkout.session.completed → `deposit.late_payment` → automatic
  refund `re_3Ugm8iBsmWz9nN6A0MANdLUu` succeeded.
- Deposit `refunded` (reason late_payment, actor system); **booking stays `lapsed`**.
- The return /p shows the lapsed page ("如已付款，款項將會全數退回").

### W7 staff create with Require deposit. PASS
- New booking form (phone, 4 guests, 2026-11-30 19:30): "收取訂金 HK$400 … 須於 24 小時內付款" checked by default →
  201 `awaiting_deposit`, deposit awaiting, 24 h hold (13:57Z next day), event created (user).
- The response carries `message: not_delivered` and `paymentUrl` (/p link). This diner has no open WhatsApp
  window and the local stack has no approved `booking_deposit_request` template, so the toast offers Copy link.
- The row's Copy link and `GET …/deposit/link` → checkout.stripe.com.
- Pay via the /p link → Checkout → paid → booking **confirmed** (creator).
- The confirmed message was not delivered for that diner (no window, no template; row 未能送達). W7b repeated
  the flow for a diner who had messaged the restaurant:
  - The deposit-link text was delivered ("我們已為你在W6b Deposit Kitchen保留2026-11-30 20:00的座位,共4位。請於2026-11-29 21:59前繳付訂金HK$400…/p/<token>").
  - After paying, "你的訂座已確認。…" was delivered.
- Screenshots: `w6b-w7-staff-form-require-deposit-zh.png`, `w6b-w7-staff-row-awaiting-zh.png`,
  `w6b-staff-rows-badges-paid-refunded-awaiting-zh.png`, `w6b-w7-p-paid-confirmed-390.png`.

### W8 WhatsApp AI agent through its real inbound path (Gemini key in .env.local works). PASS
- The AI settings start with the booking tools off. They were enabled in Settings, with mode auto.
- The diner wrote "你好，我想訂 2026年11月29日 晚上7:30，4位，姓陳。".
  - Worker `agent.reply` with tool propose_booking.
  - Reply: the summary plus "此訂座需要收取訂金 HK$400（每位 HK$100）… 請於 30 分鐘內完成付款".
- The diner wrote "好的，資料正確，請幫我確認訂座。" → tool create_booking_request → booking `awaiting_deposit`
  (source agent) and the link text: "請於 22:36 前付訂金 HK$400 … /p/<token>", the deposit rule, the Stripe
  sentence (zh-HK + en), and the AI disclosure.
- Pay → `pi_3UgmH8BsmWz9nN6A0HWtviPZ` → booking `pending` + "陳你好,我們已收到你…的訂座要求" (received).
- Note: a bare "確認" was answered by the member-join prompt, not the agent (pre-existing routing, not BOOK-014).

### W9 PAP. PASS
- `POST /api/poppy/<publicId>/bookings` (3 guests) → `awaiting_confirmation` + confirm code. Its
  collection_statement includes the Stripe sentence.
- The confirm text from the booking phone (faked inbound) → booking `awaiting_deposit` and the link message
  (amount, pay-by 22:37, /p link, Stripe sentence, collection statement).
- `GET …/bookings/<id>` with `X-Booking-Status-Token` → `status: awaiting_deposit`,
  `deposit {amount "300", HKD, expires_at}`, `payment_url` on checkout.stripe.com (`w9-pap-status-awaiting.json`).
- Pay → `pi_3UgmIaBsmWz9nN6A09Chm2HH` → `pending` + received text. Status now `pending` (`w9-pap-status-paid.json`).

### W10 not Active, then real account.updated delivery. PASS
- The restaurant's account row was set to `restricted` / charges off / `requirements.past_due` in the DB (the
  brief's "point the restaurant at a non-active row").
- A new /b booking (4 guests) showed no deposit line, terms or Stripe sentence; the button read "提交訂座要求".
  It was submitted as `pending` with **no deposit row**, and the received text was sent.
- Settings: 需要處理, "Stripe 需要你補充資料…", and the paused warning "Stripe 未啟用，新訂座暫時不收訂金…".
- **Real account.updated:** a metadata update on `acct_1UgkeeBsmWz9nN6A` through the API made Stripe emit
  `evt_1UgmJtBsmWz9nN6AlVza01OW`. stripe listen delivered it (200), and the app logged
  `payment_account.status … active`. The row went back to `active` with `last_webhook_at` 14:09:40Z (the
  event's time). The chip is Active again with no paused warning. This is real account.updated delivery
  driving the chip.
- Screenshots: `w6b-w10-b-no-deposit-390.png`, `w6b-w10-b-submitted-390.png`, `w6b-w10-settings-not-active-warning-zh.png`, `w6b-w10-settings-active-after-account-updated-zh.png`.

## Findings
- **A. A refund Stripe fails after it first succeeded is never surfaced (needs a ruling: state machine).**
  - Stripe's test card 4000000000005126 (W3c `W3c Failing Refund Ng`): decline → refund
    `re_3UgmOuBsmWz9nN6A1Zt4V8Xy` succeeded → deposit `refunded`.
  - About 6 minutes later Stripe failed it (`failure_reason: expired_or_canceled_card`): refund.updated
    `evt_3UgmOuBsmWz9nN6A1nIpjC1t` and refund.failed `evt_3UgmOuBsmWz9nN6A1mUnsEJE`, both 200.
  - `onRefundEvent` → `finishRefund` returns null for an already-refunded deposit → 'duplicate', with no log
    line. The deposit stays `refunded`, the staff badge says 已退款, and the diner never gets the money.
  - Moving refunded → refund_failed (so Retry or the sweep can act) changes the deposit state machine, so per
    escalate_if this was not fixed.
- **B. Adaptive Pricing on the connected account.**
  - Checkout defaults to the payer's local currency by IP (this Mac's VPN exit is in Taiwan → NT$1,753.31 for
    HK$400). HK$ is offered as the other choice.
  - Every walk payment after W2's went through in the NT$ presentment, because the driver's HKD radio pick did
    not find the selector in time (only W2 shows HK$400.00 selected). All of them settled as
    20000/30000/40000 **hkd** on the payment intent, and the session amount stayed HKD, so deposit amounts,
    the paid check and refunds are unaffected.
  - It is the restaurant's own Stripe setting (Standard account). The owner may want the onboarding guide to
    mention it.

## Notes (no action)
- `rate limiter unavailable, allowing` was logged once on the first /b submit after start (BOOK-001 fail-open
  while Redis warms up); it did not recur.
- /p for a paid staff hold that is now confirmed still reads "Deposit paid, request sent" (W6a: confirmed → paid
  state). It is a copy nit.
- The en/zh-HK UI language is the server's `NEXT_PUBLIC_DEFAULT_LOCALE`, and /p and the statements are
  bilingual on one page. The en screenshots come from a restart with `WALK_LOCALE=en`.
