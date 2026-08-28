import './load-env'
import { parseArgs } from 'node:util'
import { execFileSync } from 'node:child_process'
import { createTenant } from '@/application/create-tenant'

const WEBHOOK_URL_BY_ENV: Record<string, string> = {
  prod: 'https://app.ohmyclient.io/api/webhooks/whatsapp',
  dev: 'https://staging.ohmyclient.io/api/webhooks/whatsapp',
}
const WEBHOOK_EVENTS = [
  'whatsapp.message.received', 'whatsapp.message.sent', 'whatsapp.message.delivered',
  'whatsapp.message.read', 'whatsapp.message.failed', 'whatsapp.conversation.created',
  'whatsapp.conversation.ended', 'whatsapp.conversation.inactive',
]
const USAGE = `Usage: tsx scripts/onboard-tenant.ts --name <n> --slug <s> --email <e> \\
  --password <p> --whatsapp-number <+E164> --phone-number-id <id> \\
  --business-account-id <waba_id> [--env <prod|dev>] [--webhook-url <url>] [--dry-run]

Creates the tenant (restaurant + admin) and registers a Kapso phone-number
webhook signed with KAPSO_WEBHOOK_SECRET. Requires the kapso CLI logged in.

--env defaults to "prod" (webhook → app.ohmyclient.io). Use "dev" for staging
(webhook → staging.ohmyclient.io). Run "kapso projects use <id>" beforehand
so the webhook is registered against the correct Kapso project.
--webhook-url overrides the per-env default if given.`

interface Options {
  name: string; slug: string; email: string; password: string; whatsappNumber: string
  phoneNumberId: string; businessAccountId: string; webhookUrl: string
  env: string; dryRun: boolean
}

function exitUsage(code: number, message?: string): never {
  if (message) process.stderr.write(`${message}\n\n`)
  process.stderr.write(`${USAGE}\n`)
  process.exit(code)
}

function redactSecret(text: string): string {
  const secret = process.env.KAPSO_WEBHOOK_SECRET
  if (!secret || !text) return text
  return text.split(secret).join('***')
}

const PARSE_CONFIG = {
  options: {
    name: { type: 'string' }, slug: { type: 'string' }, email: { type: 'string' },
    password: { type: 'string' }, 'whatsapp-number': { type: 'string' },
    'phone-number-id': { type: 'string' }, 'business-account-id': { type: 'string' },
    'webhook-url': { type: 'string' }, env: { type: 'string', default: 'prod' },
    'dry-run': { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
  },
  allowPositionals: false,
} as const

function parseOptions(): Options {
  const { values } = parseArgs(PARSE_CONFIG)
  if (values.help) exitUsage(0)
  const required = ['name', 'slug', 'email', 'password', 'whatsapp-number', 'phone-number-id', 'business-account-id']
  const missing = required.filter((k) => !values[k as keyof typeof values])
  if (missing.length) exitUsage(1, `Missing required flags: ${missing.join(', ')}`)
  const env = (values.env as string) ?? 'prod'
  const defaultWebhook = WEBHOOK_URL_BY_ENV[env]
  if (!defaultWebhook) exitUsage(1, `--env must be one of: ${Object.keys(WEBHOOK_URL_BY_ENV).join(', ')}`)
  return {
    name: values.name as string, slug: values.slug as string,
    email: values.email as string, password: values.password as string,
    whatsappNumber: values['whatsapp-number'] as string,
    phoneNumberId: values['phone-number-id'] as string,
    businessAccountId: values['business-account-id'] as string,
    webhookUrl: (values['webhook-url'] as string | undefined) ?? defaultWebhook,
    env, dryRun: Boolean(values['dry-run']),
  }
}

function validate(opts: Options): void {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(opts.email)) exitUsage(1, '--email is not a valid email')
  if (!/^[a-z0-9-]+$/.test(opts.slug)) exitUsage(1, '--slug must be lowercase alphanumeric + hyphens')
  if (!/^\d+$/.test(opts.phoneNumberId)) exitUsage(1, '--phone-number-id must be numeric')
  if (!/^\d+$/.test(opts.businessAccountId)) exitUsage(1, '--business-account-id must be numeric')
  if (!opts.whatsappNumber.startsWith('+')) exitUsage(1, '--whatsapp-number must start with "+"')
  if (!opts.dryRun && !process.env.KAPSO_WEBHOOK_SECRET) {
    process.stderr.write('KAPSO_WEBHOOK_SECRET missing in env (.env.local).\n')
    process.exit(1)
  }
}

function buildWebhookArgs(phoneNumberId: string, webhookUrl: string, secret: string): string[] {
  const base = [
    'whatsapp', 'webhooks', 'new', '--phone-number-id', phoneNumberId,
    '--url', webhookUrl, '--secret-key', secret, '--kind', 'kapso',
    '--payload-version', 'v2', '--active',
  ]
  const events = WEBHOOK_EVENTS.flatMap((e) => ['--event', e])
  return [...base, ...events, '--output', 'json']
}

function registerWebhook(args: string[]): { id?: string; url?: string } {
  try {
    const raw = execFileSync('kapso', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
    const parsed = JSON.parse(raw) as { data?: { id?: string; url?: string } }
    return { id: parsed.data?.id, url: parsed.data?.url }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('kapso CLI not found on PATH. Install: npm i -g @kapso/cli && kapso login')
    const e = err as Error & { stderr?: Buffer | string }
    const stderrText = e.stderr ? (typeof e.stderr === 'string' ? e.stderr : e.stderr.toString('utf-8')) : ''
    if (stderrText) process.stderr.write(redactSecret(stderrText))
    throw new Error(redactSecret(e.message ?? String(err)))
  }
}

function printDryRun(opts: Options): void {
  const args = buildWebhookArgs(opts.phoneNumberId, opts.webhookUrl, '<KAPSO_WEBHOOK_SECRET>')
  process.stdout.write(`[dry-run] env=${opts.env} webhook=${opts.webhookUrl}\n`)
  process.stdout.write(`[dry-run] createTenant name=${opts.name} slug=${opts.slug} email=${opts.email}\n`)
  process.stdout.write(`[dry-run]   whatsapp=${opts.whatsappNumber} phoneNumberId=${opts.phoneNumberId} wabaId=${opts.businessAccountId}\n`)
  process.stdout.write(`[dry-run] invoke: kapso ${args.join(' ')}\n`)
}

function printSummary(ctx: { tenantId: string; opts: Options; webhookId?: string; webhookUrl?: string }): void {
  process.stdout.write('\nOnboarding complete.\n')
  process.stdout.write(`  tenant_id:       ${ctx.tenantId}\n`)
  process.stdout.write(`  slug:            ${ctx.opts.slug}\n`)
  process.stdout.write(`  phone_number_id: ${ctx.opts.phoneNumberId}\n`)
  process.stdout.write(`  webhook_id:      ${ctx.webhookId ?? '(see kapso output)'}\n`)
  process.stdout.write(`  webhook_url:     ${ctx.webhookUrl ?? ctx.opts.webhookUrl}\n`)
}

function printWebhookRecovery(opts: Options, tenantId: string): void {
  const args = buildWebhookArgs(opts.phoneNumberId, opts.webhookUrl, '$KAPSO_WEBHOOK_SECRET')
  process.stderr.write(`Re-run webhook step manually:\n  kapso ${args.join(' ')}\n\n`)
  process.stderr.write('Or clean up and retry from scratch by removing:\n')
  process.stderr.write(`  - Supabase: delete from restaurants where id='${tenantId}';\n`)
  process.stderr.write(`  - Supabase Auth: delete the user with email=${opts.email};\n`)
  process.stderr.write(`  - Supabase: delete from user_tenants where tenant_id='${tenantId}';\n`)
}

async function run(opts: Options): Promise<void> {
  if (opts.dryRun) { printDryRun(opts); return }
  const { id: tenantId, slug } = await createTenant({
    name: opts.name, slug: opts.slug, whatsappNumber: opts.whatsappNumber,
    kapsoPhoneNumberId: opts.phoneNumberId, metaBusinessAccountId: opts.businessAccountId,
    adminEmail: opts.email, adminPassword: opts.password,
  })
  try {
    const args = buildWebhookArgs(opts.phoneNumberId, opts.webhookUrl, process.env.KAPSO_WEBHOOK_SECRET!)
    const { id: webhookId, url: webhookUrl } = registerWebhook(args)
    printSummary({ tenantId, opts, webhookId, webhookUrl })
  } catch (err) {
    process.stderr.write(`\nTenant created (tenant_id=${tenantId} slug=${slug}) but webhook FAILED.\n`)
    printWebhookRecovery(opts, tenantId)
    throw err
  }
}

const opts = parseOptions()
validate(opts)
run(opts).catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`${redactSecret(msg)}\n`)
  if (!(err instanceof Error)) console.error(err)
  process.exit(1)
})
