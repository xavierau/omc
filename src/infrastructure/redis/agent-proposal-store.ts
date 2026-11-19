/**
 * AGENT-003 R15/R22: the agent's booking proposals in Redis.
 *
 * Key `agent003:proposal:<restaurantId>:<phone>` (from the job, R12), a hash
 * of `at` (the proposing job's inbound row time, epoch ms), `kind` (create,
 * change or cancel), `payload` (the proposal JSON), `owner` (the worker run
 * that stored it) and `ok` ('1' once confirmable, review F1), with a PEXPIRE
 * of the TTL. `takeIfEarlier` is one Lua script, so two jobs racing on the
 * same proposal get it once (single use), and a take of the wrong kind leaves
 * it. Marking and discarding are owner-checked Lua scripts too, so a run never
 * touches a newer run's proposal.
 * Commands queue while the client connects (it runs in the worker, not a
 * request path) but give up after one retry: an outage fails the tool call,
 * which the executor turns into an error response, never a booking.
 */
import { Redis } from 'ioredis'
import { parseRedisUrl, redisUrl } from './connection'
import type { AgentBookingProposal, AgentProposalKind, AgentProposalStore, TakeProposalResult } from '@/domain/ports/agent-booking-proposal'

const KINDS: readonly string[] = ['create', 'change', 'cancel'] satisfies AgentProposalKind[]
import type { AgentConversationKey } from '@/domain/ports/agent-reply'

// KEYS[1] = proposal key, ARGV[1] = the taking job's inbound row time (epoch ms), ARGV[2] = expected kind.
// Returns {0} none (or never confirmable), {1} not earlier (kept), {3} other kind (kept), {2, payload} taken (deleted).
// The not-earlier check comes before the confirmable one: a same-job take keeps R15's answer.
const TAKE_IF_EARLIER_SCRIPT = `
local v = redis.call('HMGET', KEYS[1], 'at', 'payload', 'kind', 'ok')
if not v[1] or not v[2] then return {0} end
if v[3] ~= ARGV[2] then return {3} end
if tonumber(v[1]) >= tonumber(ARGV[1]) then return {1} end
if v[4] ~= '1' then return {0} end
redis.call('DEL', KEYS[1])
return {2, v[2]}
`

// KEYS[1] = proposal key, ARGV[1] = owner. Returns 1 when the owner's proposal is now confirmable.
const MARK_CONFIRMABLE_SCRIPT = `
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'ok', '1')
return 1
`

// KEYS[1] = proposal key, ARGV[1] = owner. Deletes the proposal only while the owner still owns it.
const DISCARD_SCRIPT = `
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`

export function proposalKey(key: AgentConversationKey): string {
  return `agent003:proposal:${key.restaurantId}:${key.phone}`
}

export function createRedisProposalStore(client: Redis): AgentProposalStore {
  return {
    async save(key, proposal, ttlMs, owner) {
      const redisKey = proposalKey(key)
      const results = await client
        .multi()
        .del(redisKey)
        .hset(
          redisKey,
          'at', String(Date.parse(proposal.inboundCreatedAt)),
          'kind', proposal.kind,
          'payload', JSON.stringify(proposal),
          'owner', owner
        )
        .pexpire(redisKey, ttlMs)
        .exec()
      if (!results || results.some(([err]) => err)) throw new Error('agentProposalStore.save failed')
    },
    async markConfirmable(key, owner) {
      return (await client.eval(MARK_CONFIRMABLE_SCRIPT, 1, proposalKey(key), owner)) === 1
    },
    async discard(key, owner) {
      await client.eval(DISCARD_SCRIPT, 1, proposalKey(key), owner)
    },
    async peekKind(key) {
      const [kind, ok] = await client.hmget(proposalKey(key), 'kind', 'ok')
      return ok === '1' && kind && KINDS.includes(kind) ? (kind as AgentProposalKind) : null
    },
    async takeIfEarlier(key, inboundCreatedAt, kind): Promise<TakeProposalResult> {
      const reply = (await client.eval(
        TAKE_IF_EARLIER_SCRIPT,
        1,
        proposalKey(key),
        String(Date.parse(inboundCreatedAt)),
        kind
      )) as [number, string?]
      if (reply[0] === 1) return { kind: 'not_earlier' }
      if (reply[0] === 3) return { kind: 'other_kind' }
      if (reply[0] !== 2 || typeof reply[1] !== 'string') return { kind: 'none' }
      return { kind: 'taken', proposal: JSON.parse(reply[1]) as AgentBookingProposal }
    },
  }
}

let client: Redis | null = null
let store: AgentProposalStore | null = null

export function getAgentProposalStore(): AgentProposalStore {
  if (!store) {
    client = new Redis({ ...parseRedisUrl(redisUrl()), maxRetriesPerRequest: 1, connectTimeout: 5000 })
    client.on('error', (err) => console.error('[AgentProposalStore] Redis error:', err.message))
    store = createRedisProposalStore(client)
  }
  return store
}
