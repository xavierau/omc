// AGENT-001 W1: reply bounding, disclosure and history turns (AC-R10, AC-R11).
import { describe, it, expect } from 'vitest'
import { boundReply, cutChars, replyBudget, toAgentTurns, withDisclosure } from '../agent-reply-text'
import { DEFAULT_DISCLOSURE_TEXT } from '@/domain/value-objects/agent-config'

describe('AC-R10 boundReply', () => {
  it('AC-R10 a 5,000-char text + disclosure fits in maxReplyChars', () => {
    const reply = boundReply('x'.repeat(5000), 600, DEFAULT_DISCLOSURE_TEXT)
    expect(Array.from(withDisclosure(reply, DEFAULT_DISCLOSURE_TEXT)).length).toBeLessThanOrEqual(600)
    expect(reply.length).toBe(replyBudget(600, DEFAULT_DISCLOSURE_TEXT))
  })

  it('AC-R10 counts code points: never splits an emoji or CJK pair', () => {
    const cut = cutChars('😀'.repeat(10), 3)
    expect(cut).toBe('😀😀😀')
    expect(Array.from(boundReply('𠀋'.repeat(1000), 300, 'd')).length).toBe(replyBudget(300, 'd'))
  })

  it('AC-R10 whitespace-only text bounds to empty (the worker treats it as a failure)', () => {
    expect(boundReply('  \n\t ', 600, 'd')).toBe('')
  })

  it('AC-R11 withDisclosure ends the message with a blank line + the disclosure', () => {
    expect(withDisclosure('Hi', DEFAULT_DISCLOSURE_TEXT)).toBe(`Hi\n\n${DEFAULT_DISCLOSURE_TEXT}`)
  })
})

describe('toAgentTurns', () => {
  it('merges consecutive rows of one role and drops leading model rows', () => {
    const rows = [
      { role: 'model' as const, text: 'old reply', createdAt: '1' },
      { role: 'user' as const, text: 'a', createdAt: '2' },
      { role: 'user' as const, text: 'b', createdAt: '3' },
      { role: 'model' as const, text: 'c', createdAt: '4' },
      { role: 'user' as const, text: 'd', createdAt: '5' },
    ]
    expect(toAgentTurns(rows)).toEqual([
      { role: 'user', text: 'a\nb' },
      { role: 'model', text: 'c' },
      { role: 'user', text: 'd' },
    ])
  })
})
