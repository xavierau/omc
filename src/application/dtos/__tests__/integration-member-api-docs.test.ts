// INT-001 WI-11: proves `docs/integrations/member-api.md` (the partner-facing
// API doc) does not silently drift from `../integration-member-api.ts` (the
// wire-type source of truth). Two directions, both load-bearing:
//
//   1. Every field name and error/enum literal exported by the DTO module is
//      exhaustively enumerated below via a `Record<keyof T, true>` (fields)
//      or a `switch`-based never-check (string-literal unions) -- a field
//      renamed/added/removed in the DTO without updating this file fails
//      `tsc --noEmit`, not silently.
//   2. Every one of those names/literals is asserted to appear verbatim in
//      the doc's text -- a doc that falls behind a DTO change fails THIS
//      test, not silently.
//
// This is a doc-freshness guard, not a doc-quality check -- it cannot catch
// prose that's wrong in a way that doesn't touch a field/literal name.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type {
  CreateMemberRequestBody,
  CreateMemberAcceptedResponse,
  CreateMemberValidationCode,
  CreateMemberValidationErrorField,
  SimpleErrorResponse,
  MemberJobErrorWire,
  OutboundConsentWire,
  OutboundSourceWire,
  ConsentLevelWire,
} from '../integration-member-api'

const DOC_PATH = new URL('../../../../docs/integrations/member-api.md', import.meta.url)
const DOC_TEXT = readFileSync(DOC_PATH, 'utf8')

function assertNever(x: never): never {
  throw new Error(`Unhandled literal: ${JSON.stringify(x)}`)
}

// --- Exhaustive field lists (tsc fails if the DTO interface's key set drifts) ---

const REQUEST_BODY_FIELDS: Record<keyof CreateMemberRequestBody, true> = {
  phone: true,
  consent_level: true,
  name: true,
  external_ref: true,
  language: true,
  send_welcome: true,
  metadata: true,
}

const ACCEPTED_RESPONSE_FIELDS: Record<keyof CreateMemberAcceptedResponse, true> = {
  job_id: true,
  status: true,
  poll_url: true,
}

const VALIDATION_ERROR_FIELD_FIELDS: Record<keyof CreateMemberValidationErrorField, true> = {
  field: true,
  code: true,
}

const MEMBER_JOB_ERROR_FIELDS: Record<keyof MemberJobErrorWire, true> = {
  code: true,
  message: true,
}

const OUTBOUND_CONSENT_FIELDS: Record<keyof OutboundConsentWire, true> = {
  effective_level: true,
  utility: true,
  marketing: true,
  grade: true,
}

// --- Exhaustive string-literal unions (tsc fails via assertNever if the union drifts) ---

function everyValidationCode(code: CreateMemberValidationCode): string {
  switch (code) {
    case 'required':
    case 'invalid_type':
    case 'invalid_e164':
    case 'invalid_enum':
    case 'too_long':
    case 'too_deep':
    case 'not_object':
      return code
    default:
      return assertNever(code)
  }
}

function everySimpleError(error: SimpleErrorResponse['error']): string {
  switch (error) {
    case 'unauthorized':
    case 'integration_inactive':
    case 'payload_too_large':
    case 'unsupported_media_type':
    case 'rate_limited':
    case 'queue_depth_exceeded':
    case 'queue_unavailable':
    case 'feature_disabled':
    case 'not_found':
    case 'result_expired':
      return error
    default:
      return assertNever(error)
  }
}

function everyJobErrorCode(code: MemberJobErrorWire['code']): string {
  switch (code) {
    case 'validation':
    case 'tenant_inactive':
    case 'integration_paused':
    case 'internal':
      return code
    default:
      return assertNever(code)
  }
}

function everyConsentLevel(level: ConsentLevelWire): string {
  switch (level) {
    case 'none':
    case 'utility':
    case 'all':
      return level
    default:
      return assertNever(level)
  }
}

function everySource(source: OutboundSourceWire): string {
  switch (source) {
    case 'whatsapp':
    case 'web':
    case 'csv_import':
    case 'partner_api':
      return source
    default:
      return assertNever(source)
  }
}

const ALL_VALIDATION_CODES: CreateMemberValidationCode[] = [
  'required',
  'invalid_type',
  'invalid_e164',
  'invalid_enum',
  'too_long',
  'too_deep',
  'not_object',
]
const ALL_SIMPLE_ERRORS: SimpleErrorResponse['error'][] = [
  'unauthorized',
  'integration_inactive',
  'payload_too_large',
  'unsupported_media_type',
  'rate_limited',
  'queue_depth_exceeded',
  'queue_unavailable',
  'feature_disabled',
  'not_found',
  'result_expired',
]
const ALL_JOB_ERROR_CODES: MemberJobErrorWire['code'][] = [
  'validation',
  'tenant_inactive',
  'integration_paused',
  'internal',
]
const ALL_CONSENT_LEVELS: ConsentLevelWire[] = ['none', 'utility', 'all']
const ALL_SOURCES: OutboundSourceWire[] = ['whatsapp', 'web', 'csv_import', 'partner_api']

// Compile-time exhaustiveness proof for every union above (never actually
// invoked for its return value -- its existence is what tsc checks).
void [
  everyValidationCode,
  everySimpleError,
  everyJobErrorCode,
  everyConsentLevel,
  everySource,
]

describe('docs/integrations/member-api.md stays in sync with the DTO', () => {
  it.each(Object.keys(REQUEST_BODY_FIELDS))('documents request field "%s"', (field) => {
    expect(DOC_TEXT).toContain(field)
  })

  it.each(Object.keys(ACCEPTED_RESPONSE_FIELDS))('documents accepted-response field "%s"', (field) => {
    expect(DOC_TEXT).toContain(field)
  })

  it.each(Object.keys(VALIDATION_ERROR_FIELD_FIELDS))('documents validation-error-field field "%s"', (field) => {
    expect(DOC_TEXT).toContain(field)
  })

  it.each(Object.keys(MEMBER_JOB_ERROR_FIELDS))('documents job-error field "%s"', (field) => {
    expect(DOC_TEXT).toContain(field)
  })

  it.each(Object.keys(OUTBOUND_CONSENT_FIELDS))('documents outbound consent field "%s"', (field) => {
    expect(DOC_TEXT).toContain(field)
  })

  it.each(ALL_VALIDATION_CODES)('documents validation code "%s"', (code) => {
    expect(DOC_TEXT).toContain(code)
  })

  it.each(ALL_SIMPLE_ERRORS)('documents simple error "%s"', (error) => {
    expect(DOC_TEXT).toContain(error)
  })

  it.each(ALL_JOB_ERROR_CODES)('documents job error code "%s"', (code) => {
    expect(DOC_TEXT).toContain(code)
  })

  it.each(ALL_CONSENT_LEVELS)('documents consent_level value "%s"', (level) => {
    expect(DOC_TEXT).toContain(level)
  })

  it.each(ALL_SOURCES)('documents outbound source value "%s"', (source) => {
    expect(DOC_TEXT).toContain(source)
  })

  it('references the exact HMAC v2 header names used by the real routes', () => {
    for (const header of ['X-OMC-Timestamp', 'X-OMC-Nonce', 'X-OMC-Signature']) {
      expect(DOC_TEXT).toContain(header)
    }
  })
})
