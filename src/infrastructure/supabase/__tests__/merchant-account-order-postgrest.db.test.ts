/**
 * BOOK-014 W6-fix F6: account events are applied in the provider's event-time
 * order. The store's write runs unmocked through supabase-js and a real
 * PostgREST over the scratch database, so the `or=(last_webhook_at...)` filter
 * on the UPDATE is proven against Postgres, not assumed.
 *
 *   scripts/book-014/scratch-db.sh up && scripts/book-014/scratch-db.sh rest
 *   RUN_DB_TESTS=1 BOOK014_POSTGREST_URL=http://127.0.0.1:55497 \
 *     BOOK014_POSTGREST_JWT_SECRET=<printed by the script> PGPORT=55496 \
 *     npx vitest run src/infrastructure/supabase/__tests__/merchant-account-order-postgrest.db.test.ts
 *
 * supabase-js calls `<url>/rest/v1/...`; a local proxy strips that prefix for
 * the standalone PostgREST. The key is a service_role JWT signed with the
 * scratch-only secret. Cleanup deletes only the restaurant this run created.
 */
import { execFileSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { merchantPaymentAccountStore } from '@/infrastructure/supabase/repositories/merchant-payment-account-store'

const REST = process.env.BOOK014_POSTGREST_URL
const SECRET = process.env.BOOK014_POSTGREST_JWT_SECRET
const d = process.env.RUN_DB_TESTS === '1' && REST && SECRET ? describe : describe.skip

const PG = ['-X', '-h', process.env.PGHOST ?? '127.0.0.1', '-p', process.env.PGPORT ?? '55496', '-U', process.env.PGUSER ?? 'postgres', '-d', process.env.PGDATABASE ?? 'postgres']
const psql = (sql: string) =>
  execFileSync('psql', [...PG, '-v', 'ON_ERROR_STOP=1', '-qtAc', sql], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? 'postgres' }, encoding: 'utf8' }).trim()

const b64 = (v: object | string) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')
function serviceRoleJwt(secret: string): string {
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 })}`
  return `${head}.${createHmac('sha256', secret).update(head).digest('base64url')}`
}

const ACTIVE = { status: 'active' as const, chargesEnabled: true, detailsSubmitted: true, currency: 'HKD', restrictionReason: null }
const RESTRICTED = { status: 'restricted' as const, chargesEnabled: false, detailsSubmitted: true, currency: 'HKD', restrictionReason: 'requirements.past_due' }

let server: http.Server
let rid: string
let accountId: string
const providerAccountId = `acct_w6fix_${randomUUID().slice(0, 8)}`

d('W6-fix F6: merchantPaymentAccountStore.applyStatus through a real PostgREST', () => {
  beforeAll(async () => {
    const target = new URL(REST as string)
    server = http.createServer((req, res) => {
      const path = (req.url ?? '/').replace(/^\/rest\/v1/, '')
      const upstream = http.request({ host: target.hostname, port: target.port, path, method: req.method, headers: { ...req.headers, host: target.host } }, (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers)
        up.pipe(res)
      })
      req.pipe(upstream)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleJwt(SECRET as string)
    rid = randomUUID()
    psql(`INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES ('${rid}', 'BOOK-014 W6-fix', 'book014-w6fix-${rid}', '+85230000000')`)
    accountId = psql(
      `INSERT INTO merchant_payment_accounts (restaurant_id, provider_code, provider_account_id) VALUES ('${rid}', 'stripe', '${providerAccountId}') RETURNING id`
    )
  })

  afterAll(async () => {
    if (rid) psql(`DELETE FROM restaurants WHERE id = '${rid}'`)
    await new Promise<void>((resolve) => server?.close(() => resolve()))
  })

  const lastWebhookAt = () => psql(`SELECT coalesce(to_char(last_webhook_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), '-') FROM merchant_payment_accounts WHERE id = '${accountId}'`)
  const status = () => psql(`SELECT status FROM merchant_payment_accounts WHERE id = '${accountId}'`)
  const apply = (update: typeof ACTIVE | typeof RESTRICTED, eventAt?: string) =>
    merchantPaymentAccountStore.applyStatus({ accountId, providerAccountId, update, at: new Date(), ...(eventAt ? { eventAt: new Date(eventAt) } : {}) })

  it('F6 first event applies and stores its time; an older one is skipped (null); an equal or newer one applies', async () => {
    expect(lastWebhookAt()).toBe('-')
    expect(await apply(ACTIVE, '2026-11-28T10:00:05Z')).toMatchObject({ status: 'active', chargesEnabled: true })
    expect(lastWebhookAt()).toBe('2026-11-28T10:00:05')

    expect(await apply(RESTRICTED, '2026-11-28T10:00:01Z')).toBeNull()
    expect(status()).toBe('active')
    expect(lastWebhookAt()).toBe('2026-11-28T10:00:05')

    expect(await apply(RESTRICTED, '2026-11-28T10:00:05Z')).toMatchObject({ status: 'restricted' })
    expect(await apply(ACTIVE, '2026-11-28T10:00:09.250Z')).toMatchObject({ status: 'active' })
    expect(lastWebhookAt()).toBe('2026-11-28T10:00:09')
  })

  it('no eventAt (the refresh path) writes the status and leaves last_webhook_at as it was', async () => {
    expect(await apply(RESTRICTED)).toMatchObject({ status: 'restricted' })
    expect(lastWebhookAt()).toBe('2026-11-28T10:00:09')
  })
})
