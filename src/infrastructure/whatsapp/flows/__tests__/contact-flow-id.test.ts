import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveContactFlowId } from '../contact-flow-id'

describe('resolveContactFlowId', () => {
  const ORIGINAL = process.env.WHATSAPP_CONTACT_FLOW_ID

  beforeEach(() => {
    delete process.env.WHATSAPP_CONTACT_FLOW_ID
  })

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.WHATSAPP_CONTACT_FLOW_ID
    } else {
      process.env.WHATSAPP_CONTACT_FLOW_ID = ORIGINAL
    }
  })

  it('returns null when unset', () => {
    expect(resolveContactFlowId()).toBeNull()
  })

  it('returns null when set to an empty string', () => {
    process.env.WHATSAPP_CONTACT_FLOW_ID = ''
    expect(resolveContactFlowId()).toBeNull()
  })

  it('returns null when set to whitespace only', () => {
    process.env.WHATSAPP_CONTACT_FLOW_ID = '   '
    expect(resolveContactFlowId()).toBeNull()
  })

  it('returns the trimmed flow id when set', () => {
    process.env.WHATSAPP_CONTACT_FLOW_ID = '  1234567890  '
    expect(resolveContactFlowId()).toBe('1234567890')
  })
})
