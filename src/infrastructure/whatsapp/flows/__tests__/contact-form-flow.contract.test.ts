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
import { DEFAULT_LABELS } from '@/domain/services/contact-config'
import {
  FLOW_PREFILL_PHONE_KEY,
  FLOW_LABEL_DATA_KEYS,
} from '@/app/api/webhooks/whatsapp/contact-handler'

interface FlowNode {
  type?: string
  name?: string
  label?: string
  title?: string
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

  // REPLY-007 AD-6: every screen-data key is a fixed point of BOTH the SDK's
  // Flow-JSON converter (toFlowJsonWireCase) and its outbound-message
  // converter (toSnakeCaseDeep) only when it has no uppercase letters — see
  // the long comment atop `scripts/deploy-contact-flow.ts`. This is the
  // mechanical guard against the two-converter trap that already caused one
  // silent bug (a mixed-case key surviving the Flow JSON but getting
  // snake_cased on the wire, breaking the binding).
  it('every screen data key is a single lowercase token (two-converter casing guard)', () => {
    const dataKeys = Object.keys(screen.data)
    expect(dataKeys.length).toBeGreaterThan(0)
    for (const key of dataKeys) {
      expect(key).toMatch(/^[a-z]+$/)
    }
  })

  it('screen data keys equal exactly the shipped + label key set (schema/payload lockstep)', () => {
    const expectedKeys = new Set([
      'topics',
      FLOW_PREFILL_PHONE_KEY,
      ...Object.values(FLOW_LABEL_DATA_KEYS),
    ])
    expect(new Set(Object.keys(screen.data))).toEqual(expectedKeys)
  })

  it('screen title binds to the title label data key', () => {
    expect(screen.title).toBe(`\${data.${FLOW_LABEL_DATA_KEYS.title}}`)
  })

  it('the clientName TextInput label binds to the name label data key', () => {
    const [nameInput] = findNodesByType(form, 'TextInput').filter(
      (node) => node.name === 'clientName'
    )
    expect(nameInput).toBeDefined()
    expect(nameInput.label).toBe(`\${data.${FLOW_LABEL_DATA_KEYS.nameLabel}}`)
  })

  it('the clientWhatsapp TextInput label binds to the phone label data key', () => {
    const [phoneInput] = findNodesByType(form, 'TextInput').filter(
      (node) => node.name === 'clientWhatsapp'
    )
    expect(phoneInput).toBeDefined()
    expect(phoneInput.label).toBe(`\${data.${FLOW_LABEL_DATA_KEYS.phoneLabel}}`)
  })

  it('the Dropdown label binds to the topic label data key', () => {
    const [dropdown] = findNodesByType(form, 'Dropdown')
    expect(dropdown).toBeDefined()
    expect(dropdown.label).toBe(`\${data.${FLOW_LABEL_DATA_KEYS.topicLabel}}`)
  })

  it('the Footer label binds to the submit label data key', () => {
    const [footer] = findNodesByType(form, 'Footer')
    expect(footer).toBeDefined()
    expect(footer.label).toBe(`\${data.${FLOW_LABEL_DATA_KEYS.submitLabel}}`)
  })

  // REPLY-007 acceptance criterion 4: "a tenant who customises nothing sees
  // exactly the shipped form". DEFAULT_LABELS (contact-config.ts) and the
  // Flow JSON's `__example__` literals previously matched only by manual
  // inspection — drift between them now fails the suite.
  it('every label __example__ literal equals its DEFAULT_LABELS entry (acceptance criterion 4)', () => {
    const data = screen.data as unknown as Record<string, { __example__?: string }>
    for (const field of Object.keys(FLOW_LABEL_DATA_KEYS) as (keyof typeof FLOW_LABEL_DATA_KEYS)[]) {
      const dataKey = FLOW_LABEL_DATA_KEYS[field]
      expect(data[dataKey].__example__).toBe(DEFAULT_LABELS[field])
    }
  })
})
