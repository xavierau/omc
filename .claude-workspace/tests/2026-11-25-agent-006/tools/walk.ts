// AGENT-006 AC-3 local walk (not in the app): the real admit step and the real
// worker job (processAgentReply with the production deps: local Supabase
// repositories, the real Gemini client on the dev key, the real prompt and
// tools). Only the outbound edges are replaced: the queue (the job runs
// inline), the WhatsApp send (captured to stdout), and the booking proposal
// store (in memory; booking is off for this tenant) so no Redis is touched.
// Usage (repo root): npx tsx <this file> "<diner text>" <wamid>
import { admitAgentDeps, agentConsoleLog, agentWorkerDeps } from '@/application/agent/agent-deps'
import { admitInboundForAgent, type AgentReplyJob } from '@/application/agent/admit-inbound-for-agent'
import { processAgentReply } from '@/application/agent/process-agent-reply'

const RESTAURANT = 'aaaaaaaa-0000-4000-8000-0000000000a6'
const PHONE = '+85290000006'
const [text, wamid] = process.argv.slice(2)

const memoryProposals = {
  save: async () => undefined,
  markConfirmable: async () => false,
  discard: async () => undefined,
  peekKind: async () => null,
}

async function main() {
  let job: AgentReplyJob | null = null
  const admit = { ...admitAgentDeps(agentConsoleLog), enqueue: async (j: AgentReplyJob) => void (job = j) }
  const decision = await admitInboundForAgent(admit, { restaurantId: RESTAURANT, phone: PHONE, wamid, text })
  console.log(JSON.stringify({ event: 'walk.admitted', decision }))
  if (!job) return
  const deps = agentWorkerDeps(async (_pn, _phone, restaurantId) => (console.log(JSON.stringify({ event: 'walk.fallback', restaurantId })), true))
  deps.booking = { ...deps.booking, proposals: memoryProposals }
  const listRecentCampaigns = deps.toolData.listRecentCampaigns
  deps.toolData = {
    ...deps.toolData,
    listRecentCampaigns: async (key, query) => {
      const out = await listRecentCampaigns(key, query)
      console.log(JSON.stringify({ event: 'walk.tool.get_recent_campaigns', query, campaigns: out.map((c) => ({ name: c.campaignName, sentAt: c.sentAt })) }))
      return out
    },
  }
  deps.getPhoneNumberId = async () => 'pn-a6-local'
  deps.sendText = async (_pn, phone, body) => {
    console.log(JSON.stringify({ event: 'walk.sent', to: phone, body }))
    return { ok: true, kapsoMessageId: `wamid.walk.${Date.now()}`, raw: null }
  }
  const result = await processAgentReply(deps, job)
  console.log(JSON.stringify({ event: 'walk.result', result }))
}

main().then(
  () => process.exit(0),
  (err) => (console.error(err), process.exit(1))
)
