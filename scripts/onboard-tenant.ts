import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local BEFORE imports that read env (e.g. @/application/create-tenant → supabase client).
const envPath = resolve(process.cwd(), '.env.local')
try {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx)
    const val = trimmed.slice(eqIdx + 1)
    if (!process.env[key]) process.env[key] = val
  }
} catch { /* .env.local is optional */ }

import { parseArgs } from 'node:util'
import { execFileSync } from 'node:child_process'
import { createTenant } from '@/application/create-tenant'

const DEFAULT_WEBHOOK_URL = 'https://app.ohmyclient.io/api/webhooks/whatsapp'
const WEBHOOK_EVENTS = [
  'whatsapp.message.received', 'whatsapp.message.sent',
  'whatsapp.message.delivered', 'whatsapp.message.read',
  'whatsapp.message.failed', 'whatsapp.conversation.created',
  'whatsapp.conversation.ended', 'whatsapp.conversation.inactive',
]

const USAGE = `Usage: tsx scripts/onboard-tenant.ts --name <n> --slug <s> --email <e> \\
  --password <p> --whatsapp-number <+E164> --phone-number-id <id> \\
  --business-account-id <waba_id> [--webhook-url <url>] [--dry-run]

Creates the tenant (restaurant + admin) and registers a Kapso phone-number
webhook signed with KAPSO_WEBHOOK_SECRET. Requires the kapso CLI logged in.`

interface Options {
  name: string; slug: string; email: string; password: string
  whatsappNumber: string; phoneNumberId: string; businessAccountId: string
  webhookUrl: string; dryRun: boolean
}

function exitUsage(code: number, message?: string): never {
  if (message) process.stderr.write(`${message}\n\n`)
  process.stderr.write(`${USAGE}\n`)
  process.exit(code)
}

const PARSE_CONFIG = {
  options: {
    name: { type: 'string' }, slug: { type: 'string' },
    email: { type: 'string' }, password: { type: 'string' },
    'whatsapp-number': { type: 'string' }, 'phone-number-id': { type: 'string' },
    'business-account-id': { type: 'string' }, 'webhook-url': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: false,
} as const

function parseOptions(): Options {
  const { values } = parseArgs(PARSE_CONFIG)
  if (values.help) exitUsage(0)
  const required = ['name', 'slug', 'email', 'password', 'whatsapp-number', 'phone-number-id', 'business-account-id']
  const missing = required.filter((k) => !values[k as keyof typeof values])
  if (missing.length) exitUsage(1, `Missing required flags: ${missing.join(', ')}`)
  return {
    name: values.name as string, slug: values.slug as string,
    email: values.email as string, password: values.password as string,
    whatsappNumber: values['whatsapp-number'] as string,
    phoneNumberId: values['phone-number-id'] as string,
    businessAccountId: values['business-account-id'] as string,
    webhookUrl: (values['webhook-url'] as string | undefined) ?? DEFAULT_WEBHOOK_URL,
    dryRun: Boolean(values['dry-run']),
  }
}

function validate(opts: Options): void {
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
    'whatsapp', 'webhooks', 'new',
    '--phone-number-id', phoneNumberId, '--url', webhookUrl,
    '--secret-key', secret, '--kind', 'kapso',
    '--payload-version', 'v2', '--active',
  ]
  const events = WEBHOOK_EVENTS.flatMap((e) => ['--event', e])
  return [...base, ...events, '--output', 'json']
}

function registerWebhook(args: string[]): { id?: string } {
  try {
    const raw = execFileSync('kapso', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'] })
    return JSON.parse(raw) as { id?: string }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('kapso CLI not found on PATH. Install: npm i -g @kapso/cli && kapso login')
    }
    throw err
  }
}

function printDryRun(opts: Options): void {
  const args = buildWebhookArgs(opts.phoneNumberId, opts.webhookUrl, '<KAPSO_WEBHOOK_SECRET>')
  process.stdout.write(`[dry-run] createTenant name=${opts.name} slug=${opts.slug} email=${opts.email}\n`)
  process.stdout.write(`[dry-run]   whatsapp=${opts.whatsappNumber} phoneNumberId=${opts.phoneNumberId} wabaId=${opts.businessAccountId}\n`)
  process.stdout.write(`[dry-run] invoke: kapso ${args.join(' ')}\n`)
}

function printSummary(ctx: { tenantId: string; opts: Options; webhookId?: string }): void {
  process.stdout.write('\nOnboarding complete.\n')
  process.stdout.write(`  tenant_id:       ${ctx.tenantId}\n`)
  process.stdout.write(`  slug:            ${ctx.opts.slug}\n`)
  process.stdout.write(`  phone_number_id: ${ctx.opts.phoneNumberId}\n`)
  process.stdout.write(`  webhook_id:      ${ctx.webhookId ?? '(see kapso output)'}\n`)
  process.stdout.write(`  webhook_url:     ${ctx.opts.webhookUrl}\n`)
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
    const { id: webhookId } = registerWebhook(args)
    printSummary({ tenantId, opts, webhookId })
  } catch (err) {
    process.stderr.write(`\nTenant created (tenant_id=${tenantId} slug=${slug}) but webhook FAILED.\n`)
    process.stderr.write(`Re-run webhook step manually: kapso whatsapp webhooks new --phone-number-id ${opts.phoneNumberId} ...\n`)
    throw err
  }
}

const opts = parseOptions()
validate(opts)
run(opts).catch((err) => { process.stderr.write(`${(err as Error).message}\n`); process.exit(1) })
