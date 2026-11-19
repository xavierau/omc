/**
 * AGENT-003 R15: the agent's booking proposals in Redis.
 *
 * Key `agent003:proposal:<restaurantId>:<phone>` (from the job, R12), a hash
 * of `at` (the proposing job's inbound row time, epoch ms) and `payload`
 * (the proposal JSON), with a PEXPIRE of the TTL. `takeIfEarlier` is one Lua
 * script, so two jobs racing on the same proposal get it once (single use).
 * Commands queue while the client connects (it runs in the worker, not a
 * request path) but give up after one retry: an outage fails the tool call,
 * which the executor turns into an error response, never a booking.
 */
import { Redis } from 'ioredis'
import { parseRedisUrl, redisUrl } from './connection'
import type { AgentBookingProposal, AgentProposalStore, TakeProposalResult } from '@/domain/ports/agent-booking-proposal'
import type { AgentConversationKey } from '@/domain/ports/agent-reply'

// KEYS[1] = proposal key, ARGV[1] = the taking job's inbound row time (epoch ms).
// Returns {0} none, {1} not earlier (kept), {2, payload} taken (deleted).
const TAKE_IF_EARLIER_SCRIPT = `
local v = redis.call('HMGET', KEYS[1], 'at', 'payload')
if not v[1] or not v[2] then return {0} end
if tonumber(v[1]) >= tonumber(ARGV[1]) then return {1} end
redis.call('DEL', KEYS[1])
return {2, v[2]}
`

export function proposalKey(key: AgentConversationKey): string {
  return `agent003:proposal:${key.restaurantId}:${key.phone}`
}

export function createRedisProposalStore(client: Redis): AgentProposalStore {
  return {
    async save(key, proposal, ttlMs) {
      const redisKey = proposalKey(key)
      const results = await client
        .multi()
        .del(redisKey)
        .hset(redisKey, 'at', String(Date.parse(proposal.inboundCreatedAt)), 'payload', JSON.stringify(proposal))
        .pexpire(redisKey, ttlMs)
        .exec()
      if (!results || results.some(([err]) => err)) throw new Error('agentProposalStore.save failed')
    },
    async takeIfEarlier(key, inboundCreatedAt): Promise<TakeProposalResult> {
      const reply = (await client.eval(
        TAKE_IF_EARLIER_SCRIPT,
        1,
        proposalKey(key),
        String(Date.parse(inboundCreatedAt))
      )) as [number, string?]
      if (reply[0] === 1) return { kind: 'not_earlier' }
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
