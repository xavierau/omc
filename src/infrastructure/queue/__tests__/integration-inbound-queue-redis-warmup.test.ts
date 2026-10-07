// Cold-Redis fix (INT-001 WI-19): `getInboundRateLimiter()`'s client uses
// `lazyConnect: true` + `enableOfflineQueue: false` (T-H5 "never fail
// open") -- combined, ioredis only starts the TCP handshake on the FIRST
// command, and with offline queueing disabled that first command is
// rejected outright before the handshake can finish. Prod smoke
// 2026-09-10: the first signed partner request after every app restart got
// `503 queue_unavailable` (release runbook, "Deferred").
//
// Fix: `getInboundRateLimiter()` now kicks off `.connect()` at
// CONSTRUCTION time (not deferred to the first command), and
// `warmInboundRateLimiter()` lets a boot hook (src/instrumentation.ts)
// await readiness with a bounded timeout before the app starts serving.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { MockRedis, instances } = vi.hoisted(() => {
  interface Instance {
    status: string
    connectCalls: number
    listeners: Map<string, Array<(...args: unknown[]) => void>>
    resolveConnect: (() => void) | null
  }
  const instances: Instance[] = []

  class MockRedis {
    status = 'wait'
    connectCalls = 0
    listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    resolveConnect: (() => void) | null = null

    constructor() {
      instances.push(this as unknown as Instance)
    }

    connect(): Promise<void> {
      this.connectCalls++
      return new Promise<void>((resolve) => {
        this.resolveConnect = () => {
          this.status = 'ready'
          this.emit('ready')
          resolve()
        }
      })
    }

    on(event: string, cb: (...args: unknown[]) => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb])
      return this
    }

    once(event: string, cb: (...args: unknown[]) => void) {
      const wrapped = (...args: unknown[]) => {
        cb(...args)
        this.listeners.set(event, (this.listeners.get(event) ?? []).filter((l) => l !== wrapped))
      }
      return this.on(event, wrapped)
    }

    emit(event: string, ...args: unknown[]) {
      ;(this.listeners.get(event) ?? []).forEach((cb) => cb(...args))
    }
  }

  return { MockRedis, instances }
})

vi.mock('ioredis', () => ({ Redis: MockRedis }))
vi.mock('bullmq', () => ({ Queue: class {}, Worker: class {} }))

describe('cold-Redis warm-up (INT-001 WI-19)', () => {
  beforeEach(() => {
    vi.resetModules()
    instances.length = 0
  })

  it('getInboundRateLimiter() connects the client immediately, not on first command', async () => {
    const { getInboundRateLimiter } = await import('../integration-inbound-queue')

    getInboundRateLimiter()

    expect(instances).toHaveLength(1)
    expect(instances[0].connectCalls).toBe(1)
  })

  it('reuses the singleton client -- a second getInboundRateLimiter() call does not connect again', async () => {
    const { getInboundRateLimiter } = await import('../integration-inbound-queue')

    getInboundRateLimiter()
    getInboundRateLimiter()

    expect(instances).toHaveLength(1)
    expect(instances[0].connectCalls).toBe(1)
  })

  it('warmInboundRateLimiter() resolves once the underlying client reaches ready', async () => {
    const { warmInboundRateLimiter } = await import('../integration-inbound-queue')

    let resolved = false
    const warmed = warmInboundRateLimiter(5000).then(() => {
      resolved = true
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(resolved).toBe(false) // still connecting -- ready not emitted yet

    instances[0].resolveConnect?.()
    await warmed
    expect(resolved).toBe(true)
  })

  it('warmInboundRateLimiter() resolves via its bounded timeout if ready is never reached (never blocks boot on a Redis outage)', async () => {
    vi.useFakeTimers()
    const { warmInboundRateLimiter } = await import('../integration-inbound-queue')

    let resolved = false
    const warmed = warmInboundRateLimiter(50).then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(60)
    await warmed
    expect(resolved).toBe(true)

    vi.useRealTimers()
  })

  it('warmInboundRateLimiter() is a no-op once the client is already ready', async () => {
    const { getInboundRateLimiter, warmInboundRateLimiter } = await import('../integration-inbound-queue')

    getInboundRateLimiter()
    instances[0].resolveConnect?.()
    expect(instances[0].status).toBe('ready')

    await warmInboundRateLimiter(5000)
    expect(instances).toHaveLength(1) // no second client constructed
  })
})
