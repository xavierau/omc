// INT-001 WI-3: `POST /api/integrations/{integrationId}/members` body
// validation (spec US-1, plan §"API Contracts"). Hand-rolled (repo has no
// zod, see the threat model's own supply-chain verdict) -- mirrors
// `integration-validators.ts`'s `{ ok, ... }` result shape.
//
// T-M3: every rejection is `{ field, code }` only -- the raw value is never
// echoed back in the result, and callers must never log it either.
// T-M9/T-M10: sizes/shape are enforced HERE, at the edge, before the job
// row or the queue ever see the payload.

import { parseE164Phone } from '@/infrastructure/phone/e164-parser'
import type { E164Phone } from '@/domain/value-objects/e164-phone'
import { isConsentLevel, type ConsentLevel } from '@/domain/value-objects/consent-level'
import type { CreateMemberValidationErrorField } from '@/application/dtos/integration-member-api'

const NAME_MAX_CODE_POINTS = 80
const EXTERNAL_REF_MAX_LENGTH = 128
const METADATA_MAX_BYTES = 2048
const METADATA_MAX_DEPTH = 3
const LANGUAGE_WIRE_VALUES = ['en', 'zh-HK'] as const

export interface ValidatedCreateMemberBody {
  phoneE164: E164Phone
  consentLevel: ConsentLevel
  name: string | null
  externalRef: string | null
  language: 'en' | 'zh_hk' | null
  sendWelcome: boolean
  metadata: Record<string, unknown> | null
}

export type ValidateCreateMemberBodyResult =
  | { ok: true; value: ValidatedCreateMemberBody }
  | { ok: false; fields: CreateMemberValidationErrorField[] }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Deliberately expressed as numeric code-point ranges (not a regex escape
// class) so the ranges are unambiguous in source: C0 controls (0-31, incl.
// \n \t \r), DEL (127), C1 controls (128-159), and the zero-width
// space/joiner family + BOM (code points 8203-8207 and 65279) that
// `e164-parser.ts` already treats as a distinct threat class (T-C2's
// sibling problem for `name`, T-M10).
function isControlOrZeroWidthCodePoint(codePoint: number): boolean {
  if (codePoint <= 31) return true
  if (codePoint >= 127 && codePoint <= 159) return true
  if (codePoint >= 8203 && codePoint <= 8207) return true
  if (codePoint === 65279) return true
  return false
}

// Tab (9), LF (10), VT (11), FF (12), CR (13) -- the whitespace-shaped
// subset of the C0 control range. These become a space (so "Ada\nLovelace"
// stays two words) before the rest of the control/zero-width range is
// dropped outright (so a bare NUL or a zero-width space vanishes with no
// residue, never merging two words together).
function isWhitespaceControlCodePoint(codePoint: number): boolean {
  return codePoint >= 9 && codePoint <= 13
}

/** Converts whitespace-shaped control characters (tab/newline/CR/...) to a
 * plain space, strips every other control character (incl. zero-width and
 * BOM), then collapses runs of whitespace to a single space and trims --
 * measured and length-checked in Unicode CODE POINTS (never UTF-16 code
 * units, which would split a surrogate pair) so an 80-emoji name is
 * accepted and an 81-emoji name is rejected, never silently truncated
 * (T-M10). */
function hygieneName(raw: string): string {
  const converted = Array.from(raw)
    .map((ch) => {
      const codePoint = ch.codePointAt(0) ?? 0
      if (isWhitespaceControlCodePoint(codePoint)) return ' '
      if (isControlOrZeroWidthCodePoint(codePoint)) return ''
      return ch
    })
    .join('')
  return converted.replace(/\s+/g, ' ').trim()
}

function codePointLength(value: string): number {
  return Array.from(value).length
}

function jsonDepth(value: unknown, depth = 0): number {
  if (Array.isArray(value)) {
    if (value.length === 0) return depth
    return Math.max(...value.map((v) => jsonDepth(v, depth + 1)))
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 0) return depth
    return Math.max(...keys.map((k) => jsonDepth(value[k], depth + 1)))
  }
  return depth
}

function err(field: string, code: CreateMemberValidationErrorField['code']): CreateMemberValidationErrorField {
  return { field, code }
}

export function validateCreateMemberBody(body: unknown): ValidateCreateMemberBodyResult {
  const fields: CreateMemberValidationErrorField[] = []

  if (!isPlainObject(body)) {
    return { ok: false, fields: [err('body', 'not_object')] }
  }

  // phone (required)
  let phoneE164: E164Phone | null = null
  if (body.phone === undefined) {
    fields.push(err('phone', 'required'))
  } else if (typeof body.phone !== 'string') {
    fields.push(err('phone', 'invalid_type'))
  } else {
    const parsed = parseE164Phone(body.phone)
    if ('error' in parsed) {
      fields.push(err('phone', 'invalid_e164'))
    } else {
      phoneE164 = parsed
    }
  }

  // consent_level (required)
  let consentLevel: ConsentLevel | null = null
  if (body.consent_level === undefined) {
    fields.push(err('consent_level', 'required'))
  } else if (typeof body.consent_level !== 'string') {
    fields.push(err('consent_level', 'invalid_type'))
  } else if (!isConsentLevel(body.consent_level)) {
    fields.push(err('consent_level', 'invalid_enum'))
  } else {
    consentLevel = body.consent_level
  }

  // name (optional, <=80 code points after hygiene -- reject, never truncate)
  let name: string | null = null
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') {
      fields.push(err('name', 'invalid_type'))
    } else {
      const cleaned = hygieneName(body.name)
      if (codePointLength(cleaned) > NAME_MAX_CODE_POINTS) {
        fields.push(err('name', 'too_long'))
      } else {
        name = cleaned.length > 0 ? cleaned : null
      }
    }
  }

  // external_ref (optional, <=128)
  let externalRef: string | null = null
  if (body.external_ref !== undefined) {
    if (typeof body.external_ref !== 'string') {
      fields.push(err('external_ref', 'invalid_type'))
    } else if (body.external_ref.length > EXTERNAL_REF_MAX_LENGTH) {
      fields.push(err('external_ref', 'too_long'))
    } else {
      externalRef = body.external_ref
    }
  }

  // language (optional, en|zh-HK -- default resolved by the caller from tenant default_language)
  let language: 'en' | 'zh_hk' | null = null
  if (body.language !== undefined) {
    if (typeof body.language !== 'string' || !LANGUAGE_WIRE_VALUES.includes(body.language as never)) {
      fields.push(err('language', 'invalid_enum'))
    } else {
      language = body.language === 'en' ? 'en' : 'zh_hk'
    }
  }

  // send_welcome (optional, default true -- D5: suppresses only)
  let sendWelcome = true
  if (body.send_welcome !== undefined) {
    if (typeof body.send_welcome !== 'boolean') {
      fields.push(err('send_welcome', 'invalid_type'))
    } else {
      sendWelcome = body.send_welcome
    }
  }

  // metadata (optional, <=2KB serialised, depth<=3, object only)
  let metadata: Record<string, unknown> | null = null
  if (body.metadata !== undefined) {
    if (!isPlainObject(body.metadata)) {
      fields.push(err('metadata', 'not_object'))
    } else {
      const serialised = JSON.stringify(body.metadata)
      const byteLength = Buffer.byteLength(serialised, 'utf8')
      if (byteLength > METADATA_MAX_BYTES) {
        fields.push(err('metadata', 'too_long'))
      } else if (jsonDepth(body.metadata) > METADATA_MAX_DEPTH) {
        fields.push(err('metadata', 'too_deep'))
      } else {
        metadata = body.metadata
      }
    }
  }

  if (fields.length > 0 || !phoneE164 || !consentLevel) {
    return { ok: false, fields }
  }

  return {
    ok: true,
    value: { phoneE164, consentLevel, name, externalRef, language, sendWelcome, metadata },
  }
}
