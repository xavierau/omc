import './load-env'
import { parseArgs } from 'node:util'
import { WhatsAppClient } from '@kapso/whatsapp-cloud-api'
import type { DeployResult, FlowValidationError } from '@kapso/whatsapp-cloud-api'
import flowJson from '@/infrastructure/whatsapp/flows/contact-form-flow.json'

// contact-form-flow.json's screen `data` field for the sender's WhatsApp number
// is named `phone`, NOT `waNumber`/`phoneNumber`. This is load-bearing, not a
// style choice — the SDK has TWO independent camelCase<->wire-case converters:
//   1. `toFlowJsonWireCase` (flows.deploy/create/updateAsset, strictCamel: true)
//      — throws on authoring keys with `_`/`-`; keys with no uppercase pass
//      through unchanged. This is what THIS script's flowJson goes through.
//   2. `toSnakeCaseDeep` (every outbound message body via client.request(),
//      including `sendInteractiveFlow`'s `flowActionPayload.data`) — silently
//      snake_cases every key with an uppercase letter, deep, no allow-list.
// `phone` is a fixed point of BOTH: no uppercase means neither converter
// touches it, so the deployed Flow's `${data.phone}` and the outbound
// `flowActionPayload.data.phone` (built in contact-handler.ts) always agree.
// `waNumber` breaks #2 only (-> `wa_number` on the wire; the deployed Flow
// still says `waNumber` -> prefill silently empty). `phoneNumber` breaks
// things a THIRD way and is worse: the SDK's own key map has an explicit
// `["phoneNumber", "phone_number"]` entry, so converter #1 would rewrite the
// screen `data` schema's key to `phone_number` at deploy time — but string
// VALUES are never rewritten, so a `${data.phoneNumber}` template elsewhere
// in this same JSON would be left referencing a key the schema no longer has,
// breaking the binding inside the deployed Flow itself. Do not rename `phone`.

const KAPSO_BASE_URL = 'https://api.kapso.ai/meta/whatsapp'
const FLOW_NAME = 'ohmyclient_contact_form'

const USAGE = `Usage: tsx scripts/deploy-contact-flow.ts --waba-id <waba_id>

Deploys and publishes the shared WhatsApp Flow used by REPLY-005's
"contact us" form mode (AD-3: one Flow shared across all tenants).

--waba-id can also be supplied via the KAPSO_WABA_ID env var.
Requires KAPSO_API_KEY in the environment (.env.local or shell env).

On success, prints the returned flowId — set it as WHATSAPP_CONTACT_FLOW_ID
in the target deploy environment.`

export interface DeployConfig {
  wabaId: string
  kapsoApiKey: string
}

export type DeployConfigResult =
  | { ok: true; config: DeployConfig }
  | { ok: false; error: string }

export function resolveDeployConfig(
  argv: string[],
  env: Record<string, string | undefined>
): DeployConfigResult {
  let wabaIdFlag: string | undefined
  try {
    const { values } = parseArgs({
      args: argv,
      options: { 'waba-id': { type: 'string' } },
      allowPositionals: false,
    })
    wabaIdFlag = values['waba-id']
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Invalid arguments: ${message}` }
  }

  const wabaId = wabaIdFlag ?? env.KAPSO_WABA_ID
  if (!wabaId) return { ok: false, error: 'Missing --waba-id (or KAPSO_WABA_ID env var).' }

  const kapsoApiKey = env.KAPSO_API_KEY
  if (!kapsoApiKey) return { ok: false, error: 'Missing KAPSO_API_KEY in the environment.' }

  return { ok: true, config: { wabaId, kapsoApiKey } }
}

export function hasValidationErrors(
  result: Pick<DeployResult, 'validationErrors'>
): boolean {
  return Boolean(result.validationErrors && result.validationErrors.length > 0)
}

function formatLocation(
  lineStart?: number,
  lineEnd?: number,
  columnStart?: number,
  columnEnd?: number
): string {
  const line =
    lineStart != null
      ? `line ${lineStart}${lineEnd != null && lineEnd !== lineStart ? `-${lineEnd}` : ''}`
      : ''
  const col =
    columnStart != null
      ? `col ${columnStart}${columnEnd != null && columnEnd !== columnStart ? `-${columnEnd}` : ''}`
      : ''
  return [line, col].filter(Boolean).join(', ')
}

function formatOneValidationError(err: FlowValidationError, index: number): string[] {
  const location = formatLocation(err.lineStart, err.lineEnd, err.columnStart, err.columnEnd)
  const header = `${index}. [${err.errorType ?? err.error}] ${err.message ?? err.error}${location ? ` (${location})` : ''}`
  const lines = [header]
  if (err.hint) lines.push(`   hint: ${err.hint}`)
  for (const p of err.pointers ?? []) {
    const pLoc = formatLocation(p.lineStart, p.lineEnd, p.columnStart, p.columnEnd)
    lines.push(`   pointer${p.path ? ` at ${p.path}` : ''}${pLoc ? ` (${pLoc})` : ''}`)
  }
  return lines
}

export function formatValidationErrors(errors: FlowValidationError[]): string[] {
  return errors.flatMap((err, i) => formatOneValidationError(err, i + 1))
}

async function main(): Promise<void> {
  const configResult = resolveDeployConfig(process.argv.slice(2), process.env)
  if (!configResult.ok) {
    process.stderr.write(`${configResult.error}\n\n${USAGE}\n`)
    process.exit(1)
  }
  const { wabaId, kapsoApiKey } = configResult.config

  const client = new WhatsAppClient({ kapsoApiKey, baseUrl: KAPSO_BASE_URL })

  let result: DeployResult
  try {
    result = await client.flows.deploy(flowJson, {
      name: FLOW_NAME,
      wabaId,
      publish: true,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`Flow deploy failed: ${message}\n`)
    process.exit(1)
  }

  if (hasValidationErrors(result)) {
    process.stderr.write('Meta rejected the Flow JSON:\n\n')
    for (const line of formatValidationErrors(result.validationErrors ?? [])) {
      process.stderr.write(`${line}\n`)
    }
    process.exit(1)
  }

  process.stdout.write(`Flow deployed and published. flowId=${result.flowId}\n`)
  if (result.versionId) process.stdout.write(`versionId=${result.versionId}\n`)
  process.stdout.write(
    `\nSet WHATSAPP_CONTACT_FLOW_ID=${result.flowId} in the target deploy environment.\n`
  )
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}
