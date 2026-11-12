# Onboard New WhatsApp Number

Connect a new WhatsApp phone number to a tenant using the `kapso` CLI and our
one-shot onboarding script. CLI-first; the script handles the webhook step so
it never gets forgotten (the failure mode that silently drops inbound messages).

## 1. Prereqs (one-time, per operator machine)

- Kapso CLI installed and logged in:
  ```bash
  npm i -g @kapso/cli
  kapso login
  kapso status   # confirm project = "OhMyClient"
  ```
- `.env.local` in the repo root contains:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `KAPSO_WEBHOOK_SECRET`  (the one shared secret for ALL per-number webhooks)
- Deeper CLI reference: `.agents/skills/integrate-whatsapp/SKILL.md`.

## 2. Decision

Ask once:

> Do you already have Meta credentials (`phone_number_id` + `business_account_id`)
> for this number?

- **No** → §A (CLI setup-link — the path for BYOS HK SIMs).
- **Yes** → skip to §C.

## §A. CLI setup-link path (most tenants)

Used when the tenant brings their own HK SIM and completes Meta's embedded signup.

```bash
# 1. Create the Kapso customer record
kapso customers new \
  --name "<TENANT_NAME>" \
  --external-id <slug> \
  --output json
# → capture customer_id

# 2. Generate a setup link (dedicated connection, no Kapso provisioning)
kapso setup \
  --customer <customer_id> \
  --connection-type dedicated \
  --no-provision-phone-number \
  --output json
# → returns setup URL

# 3. Send the setup URL to the tenant owner. They complete:
#    Facebook login → embedded signup → SMS verification on their HK number.

# 4. Once they finish, retrieve the IDs:
kapso whatsapp numbers list --output json
# → capture phone_number_id, business_account_id, display_phone_number
```

## §B. Instant Setup alternative (Kapso-provisioned US number)

Not applicable to HK tenants. If the use case is a US number owned by Kapso,
drop `--no-provision-phone-number` (i.e. use the default `--provision-phone-number`)
and the tenant gets a pre-verified US number without any SIM or SMS step.

## §C. Create tenant + register webhook (one command)

This runs `createTenant` AND creates the per-number Kapso webhook signed with
the shared `KAPSO_WEBHOOK_SECRET`. If either step is skipped manually, inbound
messages will silently fail signature verification.

```bash
./node_modules/.bin/tsx scripts/onboard-tenant.ts \
  --name "<TENANT_NAME>" \
  --slug <slug> \
  --email <admin_email> \
  --password <admin_password> \
  --whatsapp-number "<+E.164>" \
  --phone-number-id <phone_number_id> \
  --business-account-id <business_account_id>
```

Optional flags:
- `--webhook-url <url>` (default `https://app.ohmyclient.io/api/webhooks/whatsapp`)
- `--dry-run` (print the plan, no mutation)

On success, the script prints `tenant_id`, `slug`, `phone_number_id`, `webhook_id`,
and `webhook_url`. If `createTenant` succeeds but the webhook step fails, the
script prints the tenant ids so you can re-run only `kapso whatsapp webhooks new`
without creating a duplicate tenant.

## 3. Smoke test

1. Send a WhatsApp DM from a personal phone TO the new number.
2. Tail app logs (or check `whatsapp_events` / inbox in the admin UI).
3. Sign in to the app with the admin email/password — the message should appear
   in the inbox for that tenant.

## 4. Rollback

If something is wrong and you need to undo:

```bash
# Delete the webhook
kapso whatsapp webhooks list --phone-number-id <phone_number_id> --output json
kapso whatsapp webhooks delete <webhook_id>
```

- Kapso number itself: remove via the Kapso dashboard (Connected numbers).
- Supabase admin user + `restaurants` + `user_tenants` rows: delete via the
  Supabase dashboard or a SQL console (no automated rollback — we intentionally
  avoid destructive auto-cleanup).

## 5. References

- `.agents/skills/integrate-whatsapp/SKILL.md` — full CLI playbook
- `src/application/create-tenant.ts` — tenant creation use case
- `src/app/api/webhooks/whatsapp/route.ts` — inbound webhook handler
- `scripts/onboard-tenant.ts` — this workflow's one-shot script
