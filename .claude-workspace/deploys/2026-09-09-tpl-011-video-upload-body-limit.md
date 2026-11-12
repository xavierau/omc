---
id: deploys/2026-09-09-tpl-011-video-upload-body-limit
type: deploy
author: devops-engineer
created: 2026-09-09
status: active
supersedes: null
superseded_by: null
related: [kanban:TPL-011, deploys/2026-09-09-onboard-cheung-ying-hong, deploys/2026-08-28-wonb-018-019-release-runbook]
---

# Deploy: TPL-011 pre-flight — can prod accept a 16 MB video upload on `POST /api/dashboard/upload`?

Read-only investigation. Nothing was changed on the box, in Forge, in Supabase, or in the repo.

## Scope
- Question: will a 16 MB `multipart/form-data` POST (Meta's video/mp4 header limit) reach the route handler on
  `https://app.ohmyclient.io/api/dashboard/upload`, or is it cut off by nginx, Next.js, or Supabase Storage?
- Environment: production only — Forge server `3123752`, site `app.ohmyclient.io` (Forge site id `1478079`),
  host `forge@34.158.58.133`, checkout `/home/forge/app.ohmyclient.io` at `3680ffe`, nginx 1.28.1, Next.js 16.2.1
  (`next start`, `output: 'standalone'`, daemon 746791 on `:3100`), Supabase project `uzimqndenngebzgndlhd`.
- Method: SSH read of `/etc/nginx` + on-box read-only GET of the Storage bucket list (service key sourced into a
  shell variable, never echoed), repo inspection, installed Next.js source, and two unauthenticated POST probes
  against prod (rejected at auth before any read of the body by the app; no object written).
- Forge API not used: no `FORGE_API_TOKEN` in the environment (`FLOWFORGE_*` in `.env.local` is a different
  service). SSH per the onboarding runbook was the source of truth.

## Verdict
**Infrastructure already accepts 16 MB. The only blockers are in application code.**

| Layer | Effective limit for `/api/dashboard/upload` | Source (path:line) | 16 MB video |
|---|---|---|---|
| nginx, app.ohmyclient.io server block | `client_max_body_size` **not set** in the site file → inherits http level | `/etc/nginx/sites-available/app.ohmyclient.io` (symlinked from `sites-enabled`; server block lines 4–29, no directive); includes `forge-conf/3123752/site.conf`, `forge-conf/3123752/app.ohmyclient.io/before/ssl_redirect.conf` — neither sets it; `server/` and `after/` dirs empty | — |
| nginx, http level (global, all 17 sites) | **`client_max_body_size 20M`** (20,971,520 bytes) | `/etc/nginx/nginx.conf:59` `include /etc/nginx/conf.d/*.conf;` → `/etc/nginx/conf.d/uploads.conf:1` (root-owned, dated 2026-03-16, hand-placed, **not Forge-managed**) | PASS |
| nginx timeouts / buffering | defaults: `client_body_timeout 60s` (idle-between-reads, not total), `proxy_read_timeout 60s`, `proxy_request_buffering on` (body spooled to disk before proxying to `:3100`) | `grep -Rn client_body_timeout\|proxy_read_timeout\|proxy_request_buffering /etc/nginx` → no hits | PASS |
| Cloudflare | not in the path — `cloudflare.conf` only sets `set_real_ip_from`; `app.ohmyclient.io` A record resolves directly to `34.158.58.133` (from local and from the box) | `/etc/nginx/conf.d/cloudflare.conf` | n/a |
| Next.js 16.2.1 App Router route handler | **no built-in body limit** — `handle()` passes the request through unparsed; the segment-config schema has no `bodyParser`/`sizeLimit` (Pages Router only) | `node_modules/next/dist/server/route-modules/app-route/module.js`; `build/segment-config/app/app-segment-config` | PASS |
| Next.js `serverActions.bodySizeLimit` (1 MB default) | not applicable — upload is a route handler + `fetch`, not a Server Action | `next.config.ts` (no body settings at all) | n/a |
| Next.js `experimental.proxyClientMaxBodySize` (10 MB default, **silent truncation + warning**) | not applied to this route — the in-memory clone (`cloneBodyStream`) is only created inside `runMiddleware`, which runs only when the proxy matcher matches; `src/proxy.ts` matcher is `['/dashboard/:path*', '/admin/:path*']`, so `/api/dashboard/upload` never enters it | `src/proxy.ts:92-94`; `node_modules/next/dist/server/next-server.js:385` (matcher gate) → `:1196` (`cloneBodyStream`); `body-streams.js:30` `DEFAULT_BODY_CLONE_SIZE_LIMIT = 10 MB` | PASS (see latent risk) |
| App route validation | `ALLOWED_TYPES = ['image/jpeg','image/png','image/webp']`, `MAX_FILE_SIZE = 5 MB` → `400` | `src/app/api/dashboard/upload/route.ts:12-13`, `:31-41` | **BLOCKS** (code) |
| Client uploader | `<input accept="image/jpeg,image/png,image/webp">`, no client-side size check for this component | `src/components/dashboard/image-uploader.tsx:78`; caller `src/components/dashboard/wa-template-form-fields.tsx:85` (`bucket="wa-template-media"`) | **BLOCKS** (code) |
| Supabase Storage, bucket `wa-template-media` (prod) | `file_size_limit: null`, `allowed_mime_types: null` → inherits the **project global** limit; public bucket | on-box `GET $NEXT_PUBLIC_SUPABASE_URL/storage/v1/bucket` (2026-09-09 ~13:00Z). For comparison `consent-proof` has an explicit 10 MB + image/pdf allow-list | PASS at bucket level |
| Supabase Storage, project global limit | **not discoverable from repo or without a management token** (`SUPABASE_ACCESS_TOKEN` unset locally; the Storage API does not expose it). `supabase/config.toml:112 file_size_limit = "50MiB"` applies to the **local** stack only. Supabase's platform default is 50 MB, so 16 MB is expected to pass, but this is unverified | Dashboard → Project Settings → Storage, or `GET https://api.supabase.com/v1/projects/uzimqndenngebzgndlhd/config/storage` | expected PASS, unverified |

### Empirical probe (2026-09-09 13:03–13:05Z, unauthenticated, from a dev machine)
```
dd if=/dev/zero bs=1M count=16 of=16mb.bin; dd if=/dev/zero bs=1M count=21 of=21mb.bin
curl -s -o /dev/null -w '%{http_code}\n' -X POST -F 'file=@16mb.bin;type=video/mp4' 'https://app.ohmyclient.io/api/dashboard/upload?bucket=wa-template-media'
curl -s -o /dev/null -w '%{http_code}\n' -X POST -F 'file=@21mb.bin;type=video/mp4' 'https://app.ohmyclient.io/api/dashboard/upload?bucket=wa-template-media'
```
| Body | Result | Meaning |
|---|---|---|
| 16 MB | `401 {"error":"Unauthorized"}` after 112 s (slow uplink from the probe machine) | nginx accepted the whole body and proxied it; the route rejected at `getTenantContext()` **before** `request.formData()` — nothing read, nothing written |
| 21 MB | `413 Request Entity Too Large` (nginx page) in 0.6 s | the 20M http-level cap is the effective ceiling |

Both requests wrote nothing (auth fails before the body is consumed; the Storage call is never reached).

## Pre-Flight Checklist (for the eventual TPL-011 release)
- [x] nginx accepts ≥ 16 MB on this site — verified 20M effective, probe 401/413 as above
- [x] No Next.js body limit on the route — verified against installed 16.2.1 source
- [x] Bucket `wa-template-media` has no per-bucket size or MIME cap — verified via Storage API
- [ ] Supabase project global storage limit ≥ 16 MB — **verify in the Supabase dashboard** (expected 50 MB)
- [ ] Route + client code changed (dev work item, not ops): `video/mp4` in `ALLOWED_TYPES`, per-type size cap
      (16 MB video / 5 MB image), client `accept`, `normalizeExt` already yields `mp4` for `video/mp4`
- [ ] Memory headroom acknowledged: the route buffers the whole file (`file.arrayBuffer()` → `Buffer`), i.e. ~2–3×
      the file size transiently per in-flight upload (~50 MB for a 16 MB video). Box: 3,910 MB total, **878 MB
      available** at probe time (17 sites; see memory `incident_prod_vm_too_small_for_next_build`). Fine for
      dashboard-scale concurrency; not fine if uploads are ever batched or automated.

## Runbook — config change that WOULD be needed (do not apply)
**For 16 MB: none.** The effective nginx limit (20M) already exceeds Meta's video cap with ~4 MB of multipart
headroom.

If the team wants the limit to be explicit, Forge-managed, and independent of the hand-placed global file:
1. Forge → server `3123752` → site `app.ohmyclient.io` → **Edit Nginx Configuration**.
2. Inside the `server { … }` block (next to `server_tokens off;`), add:
   ```nginx
   client_max_body_size 20m;
   ```
   (A server-block value overrides the http-level one for this site only. Use `100m` only if document headers
   — Meta cap 100 MB — are in scope; do not raise the global `uploads.conf`, it applies to all 17 sites.)
3. Forge runs `nginx -t` and reloads on save. Manual equivalent on the box: `sudo nginx -t && sudo systemctl reload nginx`.
4. If the proxy matcher in `src/proxy.ts` is ever widened to cover `/api/*`, add to `next.config.ts` in the same
   change, or uploads between 10 MB and 16 MB will be **silently truncated** to 10 MB with only a server-side warning:
   ```ts
   experimental: { proxyClientMaxBodySize: '20mb' },
   ```

## Post-Deploy Verification (scripted)
```
# 1. nginx still passes 16 MB and still refuses > 20 MB (unauthenticated, writes nothing)
curl -s -o /dev/null -w '16MB %{http_code}\n' -X POST -F 'file=@16mb.bin;type=video/mp4' 'https://app.ohmyclient.io/api/dashboard/upload?bucket=wa-template-media'   # expect 401
curl -s -o /dev/null -w '21MB %{http_code}\n' -X POST -F 'file=@21mb.bin;type=video/mp4' 'https://app.ohmyclient.io/api/dashboard/upload?bucket=wa-template-media'   # expect 413
# 2. after the code change ships: an authenticated 16 MB mp4 must return 200 with a public URL; a 17 MB mp4 must
#    return 400 from the route (per-type cap), never 413 (nginx) and never a truncated object in the bucket.
# 3. on the box: no "Request body exceeded" warnings from Next (would indicate the proxy matcher now covers the route)
grep -c "Request body exceeded" /home/forge/.forge/daemon-746791.log 2>/dev/null
```

## Rollback Procedure
No change was made; nothing to roll back. If the optional server-block directive is added later and must be
reverted: remove the line in Forge's nginx editor (reload is automatic), ETR < 1 min; the site falls back to the
20M http-level value.

## Observability
- nginx site error log: `/var/log/nginx/3123752-error.log` (`access_log off` for this site — 413s are not logged
  as access lines; the probe in Post-Deploy Verification is the only signal).
- App daemon 746791 stdout for the Next.js body-truncation warning.

## Outcome
Read-only. Findings above; no drift introduced. Handed back to the caller for the TPL-011 code work item.
