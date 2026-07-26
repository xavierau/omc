import './load-env'
import { parseArgs } from 'node:util'
import { WhatsAppClient } from '@kapso/whatsapp-cloud-api'
import type { FlowValidationError } from '@kapso/whatsapp-cloud-api'
import {
  ensureContactFlowDeployed,
  resolveWaba,
  type EnsureContactFlowDeployedResult,
} from '@/application/ensure-contact-flow-deployed'
import {
  getContactFlowId,
  updateContactFlowId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { deployContactFlow, describeDeployFailure } from '@/infrastructure/kapso/flow-client'

// contact-form-flow.json's screen `data` field for the sender's WhatsApp number
// is named `phone`, NOT `waNumber`/`phoneNumber`. This is load-bearing, not a
// style choice — the SDK has TWO independent camelCase<->wire-case converters:
//   1. `toFlowJsonWireCase` (flows.deploy/create/updateAsset, strictCamel: true)
//      — throws on authoring keys with `_`/`-`; keys with no uppercase pass
//      through unchanged. This is what the deployed flowJson goes through.
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

const USAGE = `Usage: tsx scripts/deploy-contact-flow.ts --restaurant-id <uuid> [--force]

Deploys REPLY-007's per-tenant WhatsApp contact-form Flow for one tenant and
stores the resulting flow id on restaurants.whatsapp_contact_flow_id. The
tenant's WABA is resolved from its own phone number — no --waba-id needed.

The normal path is AUTOMATIC: saving contact-config in "form" mode from the
admin dashboard deploys the flow for that tenant on its own. Run this script
only for ops backfill (a tenant whose save-triggered deploy failed) or an
upgrade (--force, after a structural change to contact-form-flow.json).

--force deploys a brand-new flow and overwrites the stored flow id even when
one already exists — published flows are assumed immutable, so this is the
only way to roll out a structural Flow JSON change. The previous flow id is
then best-effort deprecated; a deprecate failure is logged, never fatal.

Requires KAPSO_API_KEY in the environment (.env.local or shell env).`

export interface ScriptConfig {
  restaurantId: string
  force: boolean
  kapsoApiKey: string
}

export type ScriptConfigResult =
  | { ok: true; config: ScriptConfig }
  | { ok: false; error: string }

export function resolveScriptConfig(
  argv: string[],
  env: Record<string, string | undefined>
): ScriptConfigResult {
  let restaurantIdFlag: string | undefined
  let force = false
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        'restaurant-id': { type: 'string' },
        force: { type: 'boolean', default: false },
      },
      allowPositionals: false,
    })
    restaurantIdFlag = values['restaurant-id']
    force = Boolean(values.force)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Invalid arguments: ${message}` }
  }

  if (!restaurantIdFlag) return { ok: false, error: 'Missing --restaurant-id.' }

  const kapsoApiKey = env.KAPSO_API_KEY
  if (!kapsoApiKey) return { ok: false, error: 'Missing KAPSO_API_KEY in the environment.' }

  return { ok: true, config: { restaurantId: restaurantIdFlag, force, kapsoApiKey } }
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

interface DeployFailure {
  error: string
  validationErrors?: FlowValidationError[]
}

type DeployOutcome = { ok: true; flowId: string } | { ok: false; failure: DeployFailure }

/**
 * `ensureContactFlowDeployed`'s Result now carries `validationErrors`
 * structurally (M2 review finding) — no more JSON round-trip through the
 * error string, so this is a straight field copy.
 */
export function toDeployOutcome(result: EnsureContactFlowDeployedResult): DeployOutcome {
  if (result.ok) return { ok: true, flowId: result.flowId }
  return {
    ok: false,
    failure: { error: result.error, validationErrors: result.validationErrors },
  }
}

async function deprecateOldFlow(oldFlowId: string, kapsoApiKey: string): Promise<void> {
  try {
    const client = new WhatsAppClient({ kapsoApiKey, baseUrl: KAPSO_BASE_URL })
    await client.flows.deprecate({ flowId: oldFlowId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(
      `Warning: best-effort deprecate of previous flow ${oldFlowId} failed: ${message}\n`
    )
  }
}

export async function forceDeploy(restaurantId: string, kapsoApiKey: string): Promise<DeployOutcome> {
  const oldFlowId = await getContactFlowId(restaurantId)
  const wabaId = await resolveWaba(restaurantId)
  if (!wabaId) return { ok: false, failure: { error: 'contact_flow.no_waba_id' } }

  const deployResult = await deployContactFlow(wabaId)
  if (!deployResult.ok || !deployResult.flowId) {
    return { ok: false, failure: describeDeployFailure(deployResult) }
  }

  await updateContactFlowId(restaurantId, deployResult.flowId)
  if (oldFlowId) await deprecateOldFlow(oldFlowId, kapsoApiKey)

  return { ok: true, flowId: deployResult.flowId }
}

function reportFailure(failure: DeployFailure): void {
  process.stderr.write(`Contact flow deploy failed: ${failure.error}\n`)
  if (failure.validationErrors && failure.validationErrors.length > 0) {
    process.stderr.write('\nMeta rejected the Flow JSON:\n\n')
    for (const line of formatValidationErrors(failure.validationErrors)) {
      process.stderr.write(`${line}\n`)
    }
  }
}

async function main(): Promise<void> {
  const configResult = resolveScriptConfig(process.argv.slice(2), process.env)
  if (!configResult.ok) {
    process.stderr.write(`${configResult.error}\n\n${USAGE}\n`)
    process.exit(1)
  }
  const { restaurantId, force, kapsoApiKey } = configResult.config

  const outcome = force
    ? await forceDeploy(restaurantId, kapsoApiKey)
    : toDeployOutcome(await ensureContactFlowDeployed(restaurantId))

  if (!outcome.ok) {
    reportFailure(outcome.failure)
    process.exit(1)
  }

  process.stdout.write(`Flow deployed. restaurantId=${restaurantId} flowId=${outcome.flowId}\n`)
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}
