# Seed `consent-proof` storage bucket (manual)

WONB-004 introduces the `consent-proof` private bucket used by the contact
import wizard to store per-batch proof artefacts (screenshots, PDFs of the
consent form actually shown to members at signup).

Supabase storage buckets are not created via SQL migrations — they live in the
storage schema and are managed through the Supabase Dashboard or the `supabase`
CLI. Operators **must** seed this bucket once per environment before WONB-004
is deployed; uploads will otherwise fail with `bucket not found`.

## Bucket configuration

| Setting | Value |
|---|---|
| Name | `consent-proof` |
| Public | **No** (private bucket — signed URLs only) |
| File size limit | `10 MB` (10485760 bytes) |
| Allowed mime types | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` |

Reads happen exclusively via short-lived signed URLs minted by
`resolveProofSignedUrl()` (default TTL 5 minutes). The **service-role** client
is the sole writer (see `src/infrastructure/supabase/storage/consent-proof-upload.ts`);
no browser-side or anon writes are permitted.

## Option A — Dashboard

1. Open `Storage` → `Create bucket`.
2. Name: `consent-proof`.
3. Toggle **Public bucket** OFF.
4. Set **File size limit** to `10 MB`.
5. Under **Allowed MIME types**, add: `image/jpeg`, `image/png`, `image/webp`,
   `application/pdf`.
6. Save. Do **not** add any RLS policies for the bucket — the service-role
   client bypasses RLS, and there is no need for tenant-direct access.

## Option B — Supabase CLI

```bash
# Requires `supabase` CLI ≥ 1.150 and `supabase login`. Run against the target
# project (linked via `supabase link`).
supabase storage create-bucket consent-proof \
  --public=false \
  --file-size-limit=10485760 \
  --allowed-mime-types=image/jpeg,image/png,image/webp,application/pdf
```

If your CLI version does not support the bucket subcommand, fall back to
Option A.

## Verification

```bash
# Anonymous read should fail (404 / 403 — bucket is private):
curl -I "$NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/public/consent-proof/__seed_check__"

# Service-role write + signed-url read is the only supported path; covered by
# integration tests `consent-proof-upload.test.ts` and
# `resolve-proof-signed-url.test.ts`.
```
