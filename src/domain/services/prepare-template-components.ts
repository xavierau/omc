import type { TemplateComponent } from '@/domain/entities/whatsapp-template'
import type { TemplateComponent as PortTemplateComponent } from '@/domain/ports/whatsapp-templates'
import { isMediaHeader, readHeaderHandle } from './template-media-header'

/**
 * Prepares dashboard-authored components for submission to Meta.
 *
 * Meta rejects a NAMED-parameter template whose text carries {{params}} without
 * a matching `example` (code 100 / subcode 2388043), so every submit path —
 * create, edit, resubmit — must send components through here.
 *
 * Output is canonical camelCase: the Kapso SDK snake-cases request bodies deep,
 * so `bodyTextNamedParams` reaches the wire as `body_text_named_params`.
 */

const EXAMPLE_VALUES: Record<string, string> = {
  customer_name: 'John',
  name: 'John',
  code: 'ABC123',
  discount: '20%',
}

const NAMED_PARAM_RE = /\{\{(\w+)\}\}/g

/**
 * Meta wants the code itself as the COPY_CODE example; this replaces the button
 * text instead. Preserved as-is from the resubmit route it was lifted from —
 * changing it is a separate question (plan risk R3).
 */
const COPY_CODE_TEXT = 'Copy offer code'

/**
 * ASCII-ises full-width braces so `｛｛name｝｝` is recognised as a param. Callers
 * persist this shape; examples below are wire decoration, not user data.
 */
export function normalizeTemplateComponents(
  components: TemplateComponent[]
): TemplateComponent[] {
  return components.map(normalizeComponent)
}

export function prepareTemplateComponents(
  components: TemplateComponent[]
): PortTemplateComponent[] {
  return normalizeTemplateComponents(components).map(prepareComponent)
}

function normalizeComponent(c: TemplateComponent): TemplateComponent {
  if (c.text === undefined) return c
  const text = c.text.replace(/｛｛/g, '{{').replace(/｝｝/g, '}}')
  return text === c.text ? c : { ...c, text }
}

function prepareComponent(c: TemplateComponent): PortTemplateComponent {
  if (c.type === 'BUTTONS') return prepareButtons(c)
  if (isMediaHeader(c)) return prepareMediaHeader(c)
  if (!c.text) return { ...c }
  return injectTextExamples(c)
}

function prepareButtons(c: TemplateComponent): PortTemplateComponent {
  const buttons = c.buttons ?? []
  return {
    ...c,
    buttons: buttons.map((b) =>
      b.type === 'COPY_CODE' ? { ...b, text: COPY_CODE_TEXT } : b
    ),
  }
}

function prepareMediaHeader(c: TemplateComponent): PortTemplateComponent {
  const handle = readHeaderHandle(c)
  if (!handle) return { ...c }

  const example = { ...c.example, headerHandle: handle }
  delete example.header_handle
  return { ...c, example }
}

function injectTextExamples(c: TemplateComponent): PortTemplateComponent {
  const params = [...(c.text ?? '').matchAll(NAMED_PARAM_RE)].map((m) => m[1])
  if (params.length === 0) return { ...c }

  const key = c.type === 'HEADER' ? 'headerTextNamedParams' : 'bodyTextNamedParams'
  return {
    ...c,
    example: {
      [key]: params.map((p) => ({
        paramName: p,
        example: EXAMPLE_VALUES[p] ?? 'example',
      })),
    },
  }
}
