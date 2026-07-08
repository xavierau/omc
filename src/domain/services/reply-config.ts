/**
 * Per-restaurant fallback-reply configuration (REPLY-003).
 *
 * Pure domain module — zero infra imports. Owns the shape of the tenant's
 * `reply_config` JSON blob, the defaults, and the normalize/merge logic used by
 * both the repository (reading a stored blob) and the settings API (validating
 * an inbound edit). Keeping it here lets the pure fallback-menu builder and the
 * webhook handlers depend on the feature type without importing Supabase.
 */

export type ReplyFeatureKey = 'points' | 'rewards' | 'redeem' | 'card'
export type ReplyFeatures = Record<ReplyFeatureKey, boolean>

/** Every function is ON by default => existing tenants are unchanged. */
export const DEFAULT_REPLY_FEATURES: ReplyFeatures = {
  points: true,
  rewards: true,
  redeem: true,
  card: true,
}

export type ReplyTextKey = 'unknown' | 'help' | 'join'
export interface LocalizedText {
  en: string | null
  zh: string | null
}
export type ReplyText = Record<ReplyTextKey, LocalizedText>

export interface ResolvedReplyConfig {
  features: ReplyFeatures
  text: ReplyText
}

/**
 * Per-message character caps. `unknown` and `join` are sent as an interactive
 * message body (WhatsApp caps at 1024); `help` is a plain text message (cap
 * 4096, kept conservative at 2048). Applied both as a clamp when reading and as
 * a reject threshold at the API boundary.
 */
export const REPLY_TEXT_MAX: Record<ReplyTextKey, number> = {
  unknown: 1024,
  help: 2048,
  join: 1024,
}

const FEATURE_KEYS = Object.keys(DEFAULT_REPLY_FEATURES) as ReplyFeatureKey[]
const TEXT_KEYS: ReplyTextKey[] = ['unknown', 'help', 'join']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, max)
}

function resolveFeatures(raw: unknown): ReplyFeatures {
  const obj = isRecord(raw) ? raw : {}
  const out = { ...DEFAULT_REPLY_FEATURES }
  for (const key of FEATURE_KEYS) {
    // A function is disabled ONLY when explicitly `false`. A missing key, null,
    // or any non-boolean leaves it enabled (fail toward today's behavior).
    if (obj[key] === false) out[key] = false
  }
  return out
}

function resolveLocalized(raw: unknown, max: number): LocalizedText {
  const obj = isRecord(raw) ? raw : {}
  return { en: normalizeText(obj.en, max), zh: normalizeText(obj.zh, max) }
}

function resolveText(raw: unknown): ReplyText {
  const obj = isRecord(raw) ? raw : {}
  return {
    unknown: resolveLocalized(obj.unknown, REPLY_TEXT_MAX.unknown),
    help: resolveLocalized(obj.help, REPLY_TEXT_MAX.help),
    join: resolveLocalized(obj.join, REPLY_TEXT_MAX.join),
  }
}

/**
 * Merge an arbitrary stored/inbound value over the defaults into a fully-shaped
 * config. Tolerates `undefined`, `null`, malformed JSON, wrong types — anything
 * unexpected degrades to "all features ON, no custom text".
 */
export function resolveReplyConfig(raw: unknown): ResolvedReplyConfig {
  const obj = isRecord(raw) ? raw : {}
  return { features: resolveFeatures(obj.features), text: resolveText(obj.text) }
}

export type ReplyConfigValidation =
  | { ok: true; config: ResolvedReplyConfig }
  | { ok: false; error: string }

/**
 * Validate an inbound edit at the API boundary: reject any custom message that
 * exceeds its per-message cap (so the tenant is told, rather than silently
 * truncated), then normalize everything else through `resolveReplyConfig`
 * (features coerced to booleans, text trimmed, empty → null).
 */
export function validateReplyConfig(raw: unknown): ReplyConfigValidation {
  const obj = isRecord(raw) ? raw : {}
  const text = isRecord(obj.text) ? obj.text : {}
  for (const key of TEXT_KEYS) {
    const localized = isRecord(text[key]) ? text[key] : {}
    for (const lang of ['en', 'zh'] as const) {
      const value = localized[lang]
      if (typeof value === 'string' && value.trim().length > REPLY_TEXT_MAX[key]) {
        return {
          ok: false,
          error: `${key} ${lang} text exceeds ${REPLY_TEXT_MAX[key]} characters`,
        }
      }
    }
  }
  return { ok: true, config: resolveReplyConfig(raw) }
}

export { FEATURE_KEYS as REPLY_FEATURE_KEYS, TEXT_KEYS as REPLY_TEXT_KEYS }
