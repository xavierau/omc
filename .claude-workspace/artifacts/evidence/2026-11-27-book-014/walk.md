# BOOK-014 W6b: Stripe test-mode walk (status: BLOCKED at W1, 2026-11-28)

The walk could not start. Two Stripe dashboard settings on the platform account (test mode) are
missing, and both are on the brief's escalate list. No step W1–W10 ran. Nothing in Stripe was
created or changed: every probe was read-only or failed with a 400 parameter error.

## Environment (ready for the resume)
- Tree `feature/book-014-core` at 7388c35d, `next dev -p 3080` (slot 8) via `dev-run.sh`.
- Isolated local Supabase `whatsapp-crm-w4` (config `~/.cache/book014-w4-stack`). Its 097 was refreshed from
  this tree and `supabase db reset` applied 001..097 with 0 errors (97 rows in schema_migrations; the three
  W6-fix functions are present). Seeded by `seed-w6b.sh`: the fake tenant "W6b Deposit Kitchen"
  `22222222-…`, admin `walk-admin@example.test`, no payment account, deposit off.
- Walk-only Redis container `book014-w6b-redis` (127.0.0.1:56380). Kapso is faked by BOOK-013's
  `fake-kapso.cjs`, which writes the outbound log to `kapso-fake.jsonl`.
- Stripe is real test mode. `STRIPE_SECRET_KEY` (rk_test_…) and `STRIPE_MODE=test` were appended to the
  tree's gitignored `.env.local` from the main checkout with grep. `STRIPE_WEBHOOK_SECRET` is an interim
  locally generated whsec_ (the adapter needs one to build). It gets replaced once `stripe listen` works.

## Blocker 1: webhooks (`stripe listen`)
- The restricted key belongs to platform `acct_1NvaUiBOrstacydg` (HK, default currency hkd).
- The Stripe CLI on this Mac is logged in to a different account, `acct_1TMlchRu0TnXZMES`. A plain
  `stripe listen` would never see this platform's Connect events.
- `stripe listen --api-key <rk_test key> --print-secret` → 403 `more_permissions_required`: "Permission denied.
  The provided key 'rk_test_...' does not have the required permissions for this endpoint on account
  'acct_1NvaUiBOrstacydg'. Enabling Debugging Tools Write ('stripecli_session_write') permissions on this key
  would allow this request to continue."
- Permission probes, all free of side effects (a 400 means the key is permitted):

| Call | Result |
|---|---|
| POST /v1/accounts, POST /v1/account_links, POST /v1/checkout/sessions | 400 parameter_unknown (permitted) |
| POST /v1/checkout/sessions/{id}/expire | 404 resource_missing (permitted) |
| POST /v1/refunds | 400 missing payment_intent (permitted) |
| GET accounts, checkout sessions, refunds, payment_intents, events | 200 |
| POST/GET /v1/webhook_endpoints | 403 webhook_write / webhook_read |
| POST /v1/stripecli/sessions | 403 stripecli_session_write |

## Blocker 2: Connect is not activated (test mode)
- W1: as admin, Settings → Booking → 收款 → 連接 Stripe.
  - Expected: a redirect to Stripe-hosted Standard onboarding.
  - Observed: `POST /api/dashboard/settings/payments/connect` 502, and the UI shows "未能連接 Stripe，請再試一次。"
    (`w6b-blocked-connect-error-zh.png`).
  - Server log: `payment_account.connect_failed … "stripe accounts.create StripeInvalidRequestError"`.
- The same `accounts.create` (type standard) made directly with the key returns invalid_request_error:
  "You can only create new accounts if you've signed up for Connect, which you can do at
  https://dashboard.stripe.com/connect." No account was created (`GET /v1/accounts` is still empty).
- The app behaves as specified here: it fails closed, answers 502 provider_unavailable, and the log carries
  Stripe's error type only (R64).

## To unblock (owner, test mode, platform acct_1NvaUi…)
1. Sign up for Connect (platform profile, Standard accounts) at dashboard.stripe.com/connect.
2. Webhook delivery, one of:
   - (a) add Debugging Tools Write (`stripecli_session_write`) to the restricted key;
   - (b) `stripe login` into this account;
   - (c) a ruling to relay real `/v1/events` to the endpoint, signed with a local whsec_.

## Steps
| Step | Result |
|---|---|
| W1 | blocked at Connect (above) |
| W2–W10 | not run: each needs a connected account and webhook delivery |
