/**
 * Per-restaurant "Contact us" mode configuration (REPLY-005).
 *
 * Pure domain module — zero infra imports. Owns the shape of the tenant's
 * `contact_config` JSON blob, the defaults, and the normalize/validate logic
 * used by both the repository (reading a stored blob) and the settings API
 * (validating an inbound edit). Mirrors `reply-config.ts`.
 */

export type ContactMode = 'redirect' | 'form'

/**
 * Per-tenant copy for the contact-us Flow (REPLY-007): screen title, the 3
 * input labels, and the submit button label. Keys stay camelCase — this is
 * DB-internal JSONB shape and never crosses the SDK's wire converters; the
 * lowercase send-time data keys live at the contact-handler send site.
 */
export interface ContactLabels {
  title: string
  nameLabel: string
  phoneLabel: string
  topicLabel: string
  submitLabel: string
}

export interface ResolvedContactConfig {
  mode: ContactMode
  notificationEmail: string | null
  topics: string[]
  ackText: string | null
  labels: ContactLabels
}

export const TOPIC_COUNT = 5
export const TOPIC_MAX_LEN = 30
export const ACK_MAX_LEN = 1024
export const LABEL_TITLE_MAX_LEN = 30
export const LABEL_MAX_LEN = 20

/** Seed for new tenants and for any stored topic list that resolves invalid. */
export const DEFAULT_TOPICS: string[] = [
  '訂座查詢',
  '外賣及自取',
  '會員及積分查詢',
  '意見及投訴',
  '其他查詢',
]

export const DEFAULT_ACK_TEXT = '多謝您的查詢!我們的客戶服務團隊會盡快與您聯絡。'

/**
 * Shipped Flow JSON literals, verbatim — a tenant who customises nothing
 * sees byte-identical output to today's form.
 */
export const DEFAULT_LABELS: ContactLabels = {
  title: '聯絡我們',
  nameLabel: '姓名',
  phoneLabel: 'WhatsApp 號碼',
  topicLabel: '查詢主題',
  submitLabel: '提交',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, max)
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || !EMAIL_RE.test(trimmed)) return null
  return trimmed
}

function resolveMode(raw: unknown): ContactMode {
  return raw === 'form' ? 'form' : 'redirect'
}

/** Exactly TOPIC_COUNT non-empty, <=TOPIC_MAX_LEN, non-duplicate strings. */
function isValidTopicList(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length !== TOPIC_COUNT) return false
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') return false
    const trimmed = item.trim()
    if (trimmed.length === 0 || trimmed.length > TOPIC_MAX_LEN) return false
    if (seen.has(trimmed)) return false
    seen.add(trimmed)
  }
  return true
}

function resolveTopics(raw: unknown): string[] {
  // Copy, not the module-level array by reference: this runs per-request in
  // a long-lived server process, and every degrading tenant would otherwise
  // share one mutable DEFAULT_TOPICS array (code review L1).
  if (!isValidTopicList(raw)) return [...DEFAULT_TOPICS]
  return raw.map((topic) => topic.trim())
}

/** Per-field cap used by both the resolver (clamp) and validator (reject). */
const LABEL_FIELD_CAPS: Record<keyof ContactLabels, number> = {
  title: LABEL_TITLE_MAX_LEN,
  nameLabel: LABEL_MAX_LEN,
  phoneLabel: LABEL_MAX_LEN,
  topicLabel: LABEL_MAX_LEN,
  submitLabel: LABEL_MAX_LEN,
}

/**
 * Resolve each of the five label fields independently: absent/empty/
 * whitespace/non-string falls back to that field's default; an over-length
 * value is clamped, not dropped. The Flow binds all five dynamically, so the
 * result must always be a complete set of concrete strings.
 */
function resolveLabels(raw: unknown): ContactLabels {
  const obj = isRecord(raw) ? raw : {}
  const result = {} as ContactLabels
  for (const field of Object.keys(LABEL_FIELD_CAPS) as (keyof ContactLabels)[]) {
    result[field] = normalizeText(obj[field], LABEL_FIELD_CAPS[field]) ?? DEFAULT_LABELS[field]
  }
  return result
}

/**
 * Merge an arbitrary stored/inbound value over the defaults into a fully-shaped
 * config. Tolerates `undefined`, `null`, malformed JSON, wrong types — anything
 * unexpected degrades to `mode: 'redirect'` (today's wa.me behavior) with
 * default topics/ack and no notification email.
 */
export function resolveContactConfig(raw: unknown): ResolvedContactConfig {
  const obj = isRecord(raw) ? raw : {}
  return {
    mode: resolveMode(obj.mode),
    notificationEmail: normalizeEmail(obj.notificationEmail),
    topics: resolveTopics(obj.topics),
    ackText: normalizeText(obj.ackText, ACK_MAX_LEN),
    labels: resolveLabels(obj.labels),
  }
}

export type ContactConfigValidation =
  | { ok: true; config: ResolvedContactConfig }
  | { ok: false; error: string }

/** Absent/null/empty-array => "no topics supplied" (only meaningful in form mode). */
function isTopicsOmitted(value: unknown): boolean {
  if (value === undefined || value === null) return true
  return Array.isArray(value) && value.length === 0
}

/**
 * Validate an inbound edit at the API boundary: reject `mode:'form'` without a
 * syntactically valid notification email, reject an over-length ackText, and
 * validate topics shape (exactly TOPIC_COUNT unique non-empty entries within
 * TOPIC_MAX_LEN). Topics are REQUIRED only in form mode — a redirect-mode
 * tenant has no use for them and must not be forced to supply 5 they'll never
 * see. If a redirect-mode tenant DOES supply topics (e.g. pre-configuring
 * before switching to form mode), the shape is still validated so they find
 * out immediately rather than only at the moment they flip the mode.
 * Otherwise normalize via `resolveContactConfig`.
 */
export function validateContactConfig(raw: unknown): ContactConfigValidation {
  if (!isRecord(raw)) {
    return { ok: false, error: 'request body must be a JSON object' }
  }
  const obj = raw
  const mode = resolveMode(obj.mode)
  const email = normalizeEmail(obj.notificationEmail)

  if (mode === 'form' && !email) {
    return { ok: false, error: 'notificationEmail is required for form mode' }
  }

  const topicsRequired = mode === 'form'
  const topicsSupplied = !isTopicsOmitted(obj.topics)
  const topicsInvalid = topicsRequired
    ? !isValidTopicList(obj.topics)
    : topicsSupplied && !isValidTopicList(obj.topics)
  if (topicsInvalid) {
    return {
      ok: false,
      error: `topics must be exactly ${TOPIC_COUNT} unique, non-empty entries up to ${TOPIC_MAX_LEN} characters`,
    }
  }

  if (typeof obj.ackText === 'string' && obj.ackText.trim().length > ACK_MAX_LEN) {
    return { ok: false, error: `ackText exceeds ${ACK_MAX_LEN} characters` }
  }

  const labelError = validateLabels(obj.labels)
  if (labelError) {
    return { ok: false, error: labelError }
  }

  return { ok: true, config: resolveContactConfig(raw) }
}

/**
 * Labels omitted entirely => ok (nothing to validate). A field left
 * `undefined` (not supplied) is likewise fine — `resolveContactConfig` falls
 * back to its default. A field that IS supplied but isn't a string (e.g.
 * `{ title: 123 }`) is rejected outright, matching how topics reject a
 * wrong-shaped entry rather than silently defaulting it (code review L4).
 */
function validateLabels(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  for (const field of Object.keys(LABEL_FIELD_CAPS) as (keyof ContactLabels)[]) {
    const value = raw[field]
    if (value === undefined) continue
    if (typeof value !== 'string') {
      return `${field} must be a string`
    }
    const max = LABEL_FIELD_CAPS[field]
    if (value.trim().length > max) {
      return `${field} exceeds ${max} characters`
    }
  }
  return null
}
