/**
 * REPLY-005 code review H2: the Flow JSON <-> parser <-> prefill contract was
 * held together purely by comments, with zero test coverage — this is the
 * seam that already produced a real bug mid-build (camelCase vs the plan's
 * originally-proposed snake_case). This test imports the real Flow JSON and
 * asserts it agrees with the REAL constants used in production code (not
 * re-typed literals), so it fails the moment either side renames a key.
 */
import { describe, it, expect } from 'vitest'
import flow from '../contact-form-flow.json'
import { CONTACT_FORM_SUBMISSION_KEYS } from '@/domain/services/contact-form-submission'
import { FLOW_PREFILL_PHONE_KEY } from '@/app/api/webhooks/whatsapp/contact-handler'

interface FlowNode {
  type?: string
  name?: string
  children?: FlowNode[]
  onClickAction?: { payload?: Record<string, unknown> }
  initValue?: string
}

function findNodesByType(node: FlowNode, type: string): FlowNode[] {
  const matches = node.type === type ? [node] : []
  const children = node.children ?? []
  return matches.concat(children.flatMap((child) => findNodesByType(child, type)))
}

describe('contact-form-flow.json contract', () => {
  const screen = flow.screens[0]
  const form = { children: screen.layout.children } as unknown as FlowNode

  it('Footer onClickAction.payload keys match parseContactFormSubmission\'s required keys', () => {
    const [footer] = findNodesByType(form, 'Footer')
    expect(footer).toBeDefined()

    const payloadKeys = Object.keys(footer.onClickAction?.payload ?? {}).sort()
    expect(payloadKeys).toEqual([...CONTACT_FORM_SUBMISSION_KEYS].sort())
  })

  it('screen data declares the prefill key that contact-handler.ts actually sends', () => {
    expect(screen.data).toHaveProperty(FLOW_PREFILL_PHONE_KEY)
  })

  it('the clientWhatsapp TextInput is prefilled from the same data key', () => {
    const [phoneInput] = findNodesByType(form, 'TextInput').filter(
      (node) => node.name === 'clientWhatsapp'
    )
    expect(phoneInput).toBeDefined()
    expect(phoneInput.initValue).toBe(`\${data.${FLOW_PREFILL_PHONE_KEY}}`)
  })
})
