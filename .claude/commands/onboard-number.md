# Onboard New WhatsApp Number

Guide the user through connecting a brand new WhatsApp phone number to a tenant via Kapso. This is an interactive, step-by-step wizard.

## Step 0: Determine the Scenario

Ask the user:

> Which scenario applies?
>
> 1. **New tenant** — I need to create a new tenant AND connect a WhatsApp number
> 2. **Existing tenant** — I have a tenant already, just need to connect a number
> 3. **I don't have a number yet** — I need Kapso to provision one for me

## Step 1: Choose Connection Method

Explain the 3 options and ask the user to pick one:

### Option A: Instant Setup (fastest — Kapso provisions a US number)
- No SIM card needed, no SMS verification
- Kapso gives you a pre-verified US phone number
- Requires a small deposit (applied to Kapso project credits)
- Steps:
  1. Go to Kapso dashboard → **Connected numbers** → **Connect WhatsApp Business**
  2. Select **Instant setup**
  3. Authenticate via Facebook
  4. Copy the `phoneNumberId` and `businessAccountId` from the Kapso dashboard

### Option B: Bring Your Own SIM (use your own phone number)
- You provide a dedicated phone number you control
- Kapso handles Meta registration automatically
- Steps:
  1. Go to Kapso dashboard → **Connected numbers** → **Connect WhatsApp Business**
  2. Select **Bring your own SIM**
  3. Log in with Facebook
  4. Enter your phone number
  5. Complete SMS verification
  6. Copy the `phoneNumberId` and `businessAccountId` from the Kapso dashboard

### Option C: Programmatic via Kapso Platform API (for automation)
- Use when onboarding tenants programmatically (e.g., setup links)
- Kapso Setup Links let tenants self-serve the WhatsApp connection
- API: `POST https://api.kapso.ai/platform/v1/customers/{customer_id}/setup_links`
- After the tenant completes the flow, use the Connect Phone Number API:
  ```
  POST /customers/{customer_id}/whatsapp/phone_numbers
  Body: {
    "whatsapp_phone_number": {
      "name": "<label>",
      "phone_number_id": "<from Meta>",
      "business_account_id": "<WABA ID>",
      "access_token": "<permanent token>"
    }
  }
  ```

## Step 2: Collect Credentials

After the user completes the Kapso connection, ask for these values:

1. **Phone Number ID** (`kapsoPhoneNumberId`) — from Kapso dashboard or API response
2. **Meta Business Account ID** (`metaBusinessAccountId`) — the WABA ID
3. **WhatsApp display number** (`whatsappNumber`) — e.g., `+85212345678`

Validate:
- `phoneNumberId` should be a numeric string
- `whatsappNumber` should start with `+` and contain only digits after that
- `metaBusinessAccountId` should be a numeric string

## Step 3: Verify Kapso Connectivity

Run a quick test to confirm the number is working:

```typescript
// Use the existing Kapso client to resolve the WABA ID
import { resolveWabaId } from '@/infrastructure/kapso/template-client'

const wabaId = await resolveWabaId(phoneNumberId)
```

If this returns `null`, the number is not properly connected in Kapso. Ask the user to:
- Verify the `KAPSO_API_KEY` in `.env` is correct
- Confirm the number shows as "Connected" in the Kapso dashboard
- Check if ad blockers interfered with the Meta embedded signup popup

## Step 4: Create or Update Tenant

### If creating a new tenant (Scenario 1):

Ask for additional info:
- **Tenant name** (e.g., "My Restaurant")
- **Slug** (URL-friendly, e.g., "my-restaurant")
- **Admin email**
- **Admin password**

Then use the existing `createTenant` use case:

```typescript
import { createTenant } from '@/application/create-tenant'

await createTenant({
  name: tenantName,
  slug: tenantSlug,
  whatsappNumber: whatsappNumber,
  kapsoPhoneNumberId: phoneNumberId,
  metaBusinessAccountId: businessAccountId,
  adminEmail: adminEmail,
  adminPassword: adminPassword,
})
```

### If updating an existing tenant (Scenario 2):

Update the restaurant record in Supabase with the new WhatsApp credentials:
- `kapso_phone_number_id`
- `meta_business_account_id`
- `whatsapp_number`

## Step 5: Configure Webhook

Ensure the Kapso webhook is pointing to this app's webhook endpoint:

- **Webhook URL**: `{APP_URL}/api/webhooks/whatsapp`
- **Webhook secret**: should match `KAPSO_WEBHOOK_SECRET` in `.env`

Tell the user to verify this in the Kapso dashboard under the connected number's settings.

## Step 6: Test End-to-End

Guide the user through a quick smoke test:

1. Send a test message TO the new WhatsApp number from a personal phone
2. Check the app logs for the incoming webhook
3. Verify the webhook parser processes the message correctly
4. Optionally send a test outbound message:

```typescript
import { sendTextMessage } from '@/infrastructure/kapso/client'

await sendTextMessage(phoneNumberId, testPhoneNumber, 'Hello from OhMyClient!')
```

## Step 7: Summary

Print a summary of what was configured:

```
--- WhatsApp Number Onboarded ---
Tenant:              {name} ({slug})
WhatsApp Number:     {whatsappNumber}
Phone Number ID:     {phoneNumberId}
Business Account ID: {businessAccountId}
Webhook URL:         {APP_URL}/api/webhooks/whatsapp
Status:              Connected
```

## Reference Links

- Kapso Dashboard: https://kapso.ai
- Kapso Docs — Connect WhatsApp: https://docs.kapso.ai/docs/how-to/whatsapp/connect-whatsapp
- Kapso Docs — Setup Links: https://docs.kapso.ai/docs/platform/setup-links
- Kapso Docs — Connect Phone Number API: https://docs.kapso.ai/api/platform/v1/phone-numbers/connect-phone-number
- Project webhook handler: `src/app/api/webhooks/whatsapp/route.ts`
- Project Kapso client: `src/infrastructure/kapso/client.ts`
- Project tenant creation: `src/application/create-tenant.ts`
