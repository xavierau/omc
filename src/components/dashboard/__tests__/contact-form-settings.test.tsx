import { describe, it, expect, vi } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `t:${key}:${JSON.stringify(vars)}` : `t:${key}`,
}))

import { ContactFormSettings } from '@/components/dashboard/contact-form-settings'
import { DEFAULT_ACK_TEXT, TOPIC_MAX_LEN } from '@/domain/services/contact-config'

function flatten(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = []
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return
    out.push(child)
    if (typeof child.type === 'function') {
      const fn = child.type as (p: unknown) => ReactNode
      out.push(...flatten(fn(child.props)))
      return
    }
    const props = child.props as { children?: ReactNode }
    if (props.children !== undefined) out.push(...flatten(props.children))
  })
  return out
}

function renderTree(element: ReactElement): ReactElement[] {
  const fn = element.type as (p: unknown) => ReactNode
  return [...flatten(fn(element.props))]
}

const TOPICS = ['訂座查詢', '外賣及自取', '會員及積分查詢', '意見及投訴', '其他查詢']

function baseProps() {
  return {
    notificationEmail: '',
    onNotificationEmailChange: vi.fn(),
    emailInvalid: false,
    topics: TOPICS,
    onTopicChange: vi.fn(),
    ackText: '',
    onAckTextChange: vi.fn(),
  }
}

function inputs(tree: ReactElement[]): ReactElement[] {
  return tree.filter((el) => el.type === 'input')
}

describe('ContactFormSettings', () => {
  it('renders exactly five topic inputs with the stored values', () => {
    const tree = renderTree(<ContactFormSettings {...baseProps()} />)
    const topicInputs = inputs(tree).filter((el) => (el.props as { maxLength?: number }).maxLength === TOPIC_MAX_LEN)
    expect(topicInputs).toHaveLength(5)
    expect(topicInputs.map((el) => (el.props as { value: string }).value)).toEqual(TOPICS)
  })

  it('fires onTopicChange with the index and new value', () => {
    const onTopicChange = vi.fn()
    const tree = renderTree(<ContactFormSettings {...baseProps()} onTopicChange={onTopicChange} />)
    const topicInputs = inputs(tree).filter((el) => (el.props as { maxLength?: number }).maxLength === TOPIC_MAX_LEN)
    const onChange = (topicInputs[2].props as { onChange: (e: unknown) => void }).onChange
    onChange({ target: { value: '新主題' } })
    expect(onTopicChange).toHaveBeenCalledWith(2, '新主題')
  })

  it('renders the notification email input with its value', () => {
    const tree = renderTree(<ContactFormSettings {...baseProps()} notificationEmail="owner@example.com" />)
    const emailInput = inputs(tree).find((el) => (el.props as { type?: string }).type === 'email')
    expect((emailInput?.props as { value: string }).value).toBe('owner@example.com')
  })

  it('fires onNotificationEmailChange when the email input changes', () => {
    const onNotificationEmailChange = vi.fn()
    const tree = renderTree(
      <ContactFormSettings {...baseProps()} onNotificationEmailChange={onNotificationEmailChange} />
    )
    const emailInput = inputs(tree).find((el) => (el.props as { type?: string }).type === 'email')
    const onChange = (emailInput?.props as { onChange: (e: unknown) => void }).onChange
    onChange({ target: { value: 'new@example.com' } })
    expect(onNotificationEmailChange).toHaveBeenCalledWith('new@example.com')
  })

  it('shows a validation message when the email is flagged invalid', () => {
    const tree = renderTree(<ContactFormSettings {...baseProps()} emailInvalid />)
    const text = tree.find((el) => (el.props as { children?: unknown }).children === 't:contactNotificationEmailRequired')
    expect(text).toBeDefined()
  })

  it('shows no validation message when the email is valid', () => {
    const tree = renderTree(<ContactFormSettings {...baseProps()} emailInvalid={false} />)
    const text = tree.find((el) => (el.props as { children?: unknown }).children === 't:contactNotificationEmailRequired')
    expect(text).toBeUndefined()
  })

  it('uses the default acknowledgement text as the textarea placeholder', () => {
    const tree = renderTree(<ContactFormSettings {...baseProps()} />)
    const textarea = tree.find((el) => el.type === 'textarea')
    expect((textarea?.props as { placeholder: string }).placeholder).toBe(DEFAULT_ACK_TEXT)
  })

  it('renders the stored ack text in the textarea and fires onAckTextChange', () => {
    const onAckTextChange = vi.fn()
    const tree = renderTree(
      <ContactFormSettings {...baseProps()} ackText="謝謝查詢" onAckTextChange={onAckTextChange} />
    )
    const textarea = tree.find((el) => el.type === 'textarea')
    expect((textarea?.props as { value: string }).value).toBe('謝謝查詢')
    ;(textarea?.props as { onChange: (e: unknown) => void }).onChange({ target: { value: '更新' } })
    expect(onAckTextChange).toHaveBeenCalledWith('更新')
  })
})
