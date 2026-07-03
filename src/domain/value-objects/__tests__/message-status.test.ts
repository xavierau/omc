import { describe, it, expect } from 'vitest'
import { isProgression, type MessageStatus } from '../message-status'

describe('isProgression', () => {
  describe('forward lattice (queued < sent < delivered < read)', () => {
    it.each([
      ['queued', 'sent'],
      ['queued', 'delivered'],
      ['queued', 'read'],
      ['sent', 'delivered'],
      ['sent', 'read'],
      ['delivered', 'read'],
    ] as Array<[MessageStatus, MessageStatus]>)(
      '%s -> %s is a progression',
      (from, to) => {
        expect(isProgression(from, to)).toBe(true)
      }
    )
  })

  describe('regressions are blocked', () => {
    it.each([
      ['sent', 'queued'],
      ['delivered', 'sent'],
      ['delivered', 'queued'],
      ['read', 'delivered'],
      ['read', 'sent'],
      ['read', 'queued'],
    ] as Array<[MessageStatus, MessageStatus]>)(
      '%s -> %s is NOT a progression',
      (from, to) => {
        expect(isProgression(from, to)).toBe(false)
      }
    )
  })

  describe('same-state idempotency', () => {
    it.each([
      ['queued', 'queued'],
      ['sent', 'sent'],
      ['delivered', 'delivered'],
      ['read', 'read'],
      ['failed', 'failed'],
    ] as Array<[MessageStatus, MessageStatus]>)(
      '%s -> %s is NOT a progression (no-op)',
      (from, to) => {
        expect(isProgression(from, to)).toBe(false)
      }
    )
  })

  describe('failed transitions', () => {
    it.each([
      ['queued', 'failed'],
      ['sent', 'failed'],
      ['delivered', 'failed'],
    ] as Array<[MessageStatus, MessageStatus]>)(
      '%s -> failed is a progression',
      (from, to) => {
        expect(isProgression(from, to)).toBe(true)
      }
    )

    it('read -> failed is NOT a progression (read is terminal-success)', () => {
      expect(isProgression('read', 'failed')).toBe(false)
    })

    it('failed never recovers to any other state', () => {
      const targets: MessageStatus[] = ['queued', 'sent', 'delivered', 'read']
      for (const to of targets) {
        expect(isProgression('failed', to)).toBe(false)
      }
    })
  })
})
