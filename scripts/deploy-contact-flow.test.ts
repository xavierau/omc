import { describe, it, expect } from 'vitest'
import {
  resolveDeployConfig,
  hasValidationErrors,
  formatValidationErrors,
} from './deploy-contact-flow'
import type { FlowValidationError } from '@kapso/whatsapp-cloud-api'

describe('resolveDeployConfig', () => {
  it('resolves from --waba-id flag + KAPSO_API_KEY env', () => {
    const result = resolveDeployConfig(
      ['--waba-id', '12345'],
      { KAPSO_API_KEY: 'key-abc' }
    )
    expect(result).toEqual({
      ok: true,
      config: { wabaId: '12345', kapsoApiKey: 'key-abc' },
    })
  })

  it('falls back to KAPSO_WABA_ID env when --waba-id is absent', () => {
    const result = resolveDeployConfig(
      [],
      { KAPSO_WABA_ID: '999', KAPSO_API_KEY: 'key-abc' }
    )
    expect(result).toEqual({
      ok: true,
      config: { wabaId: '999', kapsoApiKey: 'key-abc' },
    })
  })

  it('prefers the --waba-id flag over the env fallback', () => {
    const result = resolveDeployConfig(
      ['--waba-id', 'flag-id'],
      { KAPSO_WABA_ID: 'env-id', KAPSO_API_KEY: 'key-abc' }
    )
    expect(result.ok && result.config.wabaId).toBe('flag-id')
  })

  it('errors when wabaId is missing from both flag and env', () => {
    const result = resolveDeployConfig([], { KAPSO_API_KEY: 'key-abc' })
    expect(result).toEqual({
      ok: false,
      error: 'Missing --waba-id (or KAPSO_WABA_ID env var).',
    })
  })

  it('errors when KAPSO_API_KEY is missing', () => {
    const result = resolveDeployConfig(['--waba-id', '12345'], {})
    expect(result).toEqual({
      ok: false,
      error: 'Missing KAPSO_API_KEY in the environment.',
    })
  })

  it('errors clearly on an unparseable argv (no throw escapes)', () => {
    const result = resolveDeployConfig(['--unknown-flag', 'x'], {
      KAPSO_API_KEY: 'key-abc',
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/Invalid arguments/)
  })
})

describe('hasValidationErrors', () => {
  it('is false when validationErrors is absent', () => {
    expect(hasValidationErrors({ validationErrors: undefined })).toBe(false)
  })

  it('is false when validationErrors is empty', () => {
    expect(hasValidationErrors({ validationErrors: [] })).toBe(false)
  })

  it('is true when validationErrors has at least one entry', () => {
    expect(
      hasValidationErrors({
        validationErrors: [{ error: 'INVALID_PROPERTY' }],
      })
    ).toBe(true)
  })
})

describe('formatValidationErrors', () => {
  it('formats message, line/column pointers, and hint', () => {
    const errors: FlowValidationError[] = [
      {
        error: 'INVALID_PROPERTY',
        errorType: 'SCHEMA',
        message: 'Unknown property "input-type"',
        lineStart: 12,
        lineEnd: 12,
        columnStart: 5,
        columnEnd: 20,
        hint: 'Use camelCase authoring.',
        pointers: [{ path: '$.screens[0].layout.children[0]', lineStart: 12, columnStart: 5 }],
      },
    ]

    const lines = formatValidationErrors(errors)

    expect(lines[0]).toBe(
      '1. [SCHEMA] Unknown property "input-type" (line 12, col 5-20)'
    )
    expect(lines).toContain('   hint: Use camelCase authoring.')
    expect(lines.some((l) => l.includes('$.screens[0].layout.children[0]'))).toBe(true)
  })

  it('numbers multiple errors and tolerates missing optional fields', () => {
    const errors: FlowValidationError[] = [
      { error: 'FIRST' },
      { error: 'SECOND', message: 'second message' },
    ]

    const lines = formatValidationErrors(errors)

    expect(lines[0]).toBe('1. [FIRST] FIRST')
    expect(lines[1]).toBe('2. [SECOND] second message')
  })
})
