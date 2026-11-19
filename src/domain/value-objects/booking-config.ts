/**
 * BOOK-001: a restaurant's booking settings (`restaurants.booking_config`).
 *
 * `resolveBookingConfig` never throws: the stored JSONB is resolved field by
 * field to safe defaults, so a malformed or missing blob behaves as mode off
 * (spec AC-3). `parseBookingSettings` validates an admin's save (R14) and
 * keeps the fields the settings form does not own (`aiRoutingEnabled`, the
 * eval gate; `templateIds`, written by template provisioning; BOOK-002's
 * `templateBodies` and `templateCandidates`, written by the message editor;
 * BOOK-003's `agentBooking`, written by its own admin routes) from the current
 * config, so a save can never switch them.
 */
import type { LanguageCode } from './language'

export type BookingMode = 'off' | 'simple' | 'external'
export type BookingTemplateKind = 'received' | 'confirmed' | 'declined' | 'reminder'
/** W3: one template row per language (zh_HK and en) for each kind. */
export type BookingTemplateIdsByLanguage = Record<LanguageCode, string | null>
/** BOOK-002: a value per language, absent when unset. */
export type BookingTemplateTextByLanguage = Partial<Record<LanguageCode, string>>

/**
 * BOOK-003: booking through personal agents (PAP 1.0). Off by default (R43).
 * `publicId` (>= 128 random bits, base64url) selects the restaurant in the
 * public agent API and is rotatable; `websiteHost` is the host that serves
 * the restaurant's poppy.json (its `organization.domain`, spec 3.1).
 */
export interface AgentBookingConfig {
  enabled: boolean
  publicId: string | null
  websiteHost: string | null
}

export interface BookingConfig {
  mode: BookingMode
  externalUrl: string | null
  /** Lifetime of links issued in chat; null = no expiry. */
  chatLinkTtlHours: number | null
  /** Lifetime of links issued by a campaign send; null = no expiry. */
  campaignLinkTtlHours: number | null
  maxPartySize: number
  aiRoutingEnabled: boolean
  /** Written only by template provisioning (W3), never by the settings PUT. */
  templateIds: Record<BookingTemplateKind, BookingTemplateIdsByLanguage>
  /** BOOK-002: the restaurant's own text per kind × language; absent = default copy. */
  templateBodies: Record<BookingTemplateKind, BookingTemplateTextByLanguage>
  /** BOOK-002: template id of a submitted edit awaiting Meta; promoted to templateIds once approved. */
  templateCandidates: Record<BookingTemplateKind, BookingTemplateTextByLanguage>
  agentBooking: AgentBookingConfig
}

export const BOOKING_MODES: readonly BookingMode[] = ['off', 'simple', 'external']
export const TEMPLATE_KINDS: readonly BookingTemplateKind[] = ['received', 'confirmed', 'declined', 'reminder']
export const TEMPLATE_LANGUAGES: readonly LanguageCode[] = ['zh_hk', 'en']
export const MAX_TTL_HOURS = 8760
export const MAX_PARTY_SIZE_LIMIT = 100
export const EXTERNAL_URL_MAX = 2048

export const DEFAULT_BOOKING_CONFIG: BookingConfig = {
  mode: 'off',
  externalUrl: null,
  chatLinkTtlHours: 24,
  campaignLinkTtlHours: 168,
  maxPartySize: 20,
  aiRoutingEnabled: false,
  templateIds: {
    received: { en: null, zh_hk: null },
    confirmed: { en: null, zh_hk: null },
    declined: { en: null, zh_hk: null },
    reminder: { en: null, zh_hk: null },
  },
  templateBodies: { received: {}, confirmed: {}, declined: {}, reminder: {} },
  templateCandidates: { received: {}, confirmed: {}, declined: {}, reminder: {} },
  agentBooking: { enabled: false, publicId: null, websiteHost: null },
}

/** BOOK-003: 128-384 bits as base64url. */
export const AGENT_PUBLIC_ID_SHAPE = /^[A-Za-z0-9_-]{22,64}$/
export const isAgentPublicId = (v: unknown): v is string => typeof v === 'string' && AGENT_PUBLIC_ID_SHAPE.test(v)

const HOST_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const WEBSITE_HOST = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})+(?::([0-9]{1,5}))?$`)

/**
 * BOOK-003: the host that serves poppy.json, as `organization.domain` needs
 * it (spec 3.1: the host, with its port when that isn't 443; compared
 * ignoring case). Accepts `www.x.hk` or `https://www.x.hk/`; anything with a
 * path, query, credentials or another scheme is null.
 */
export function normalizeWebsiteHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/$/, '')
  if (value.length === 0 || value.length > 253) return null
  const match = WEBSITE_HOST.exec(value)
  if (!match) return null
  const port = match[1]
  if (port === undefined) return value
  const n = Number(port)
  if (n < 1 || n > 65535) return null
  // Review F9: rebuilt from the parsed parts, so ':0443' is 443 and ':08443' is 8443.
  const host = value.slice(0, value.length - port.length - 1)
  return n === 443 ? host : `${host}:${n}`
}

function resolveAgentBooking(raw: unknown): AgentBookingConfig {
  const r = asRecord(raw)
  const publicId = isAgentPublicId(r.publicId) ? r.publicId : null
  return { enabled: r.enabled === true && publicId !== null, publicId, websiteHost: normalizeWebsiteHost(r.websiteHost) }
}

/** `https:` with a host, no credentials, no whitespace, ≤ 2,048 chars (R14). */
export function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > EXTERNAL_URL_MAX || /\s/.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password
  } catch {
    return false
  }
}

export const isTtl = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_TTL_HOURS
export const isPartyMax = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_PARTY_SIZE_LIMIT

function resolveTtl(raw: unknown, fallback: number): number | null {
  if (raw === null) return null
  return isTtl(raw) ? raw : fallback
}

const asRecord = (raw: unknown) => (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

function resolveIdsByLanguage(raw: unknown): BookingTemplateIdsByLanguage {
  const source = asRecord(raw)
  const ids: BookingTemplateIdsByLanguage = { en: null, zh_hk: null }
  for (const lang of TEMPLATE_LANGUAGES) {
    const value = source[lang]
    if (typeof value === 'string' && value.length > 0) ids[lang] = value
  }
  return ids
}

/** Anything but `{kind: {en, zh_hk}}` strings resolves to null (re-provisioned on the next save). */
function resolveTemplateIds(raw: unknown): BookingConfig['templateIds'] {
  const source = asRecord(raw)
  const entries = TEMPLATE_KINDS.map((kind) => [kind, resolveIdsByLanguage(source[kind])] as const)
  return Object.fromEntries(entries) as BookingConfig['templateIds']
}

function resolveTextByLanguage(raw: unknown): BookingTemplateTextByLanguage {
  const source = asRecord(raw)
  const texts: BookingTemplateTextByLanguage = {}
  for (const lang of TEMPLATE_LANGUAGES) {
    const value = source[lang]
    if (typeof value === 'string' && value.length > 0) texts[lang] = value
  }
  return texts
}

/** BOOK-002: anything but `{kind: {en?, zh_hk?}}` strings resolves to unset. */
function resolveTexts(raw: unknown): BookingConfig['templateBodies'] {
  const source = asRecord(raw)
  return Object.fromEntries(TEMPLATE_KINDS.map((kind) => [kind, resolveTextByLanguage(source[kind])])) as BookingConfig['templateBodies']
}

export function resolveBookingConfig(raw: unknown): BookingConfig {
  if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_BOOKING_CONFIG)
  const r = raw as Record<string, unknown>
  const d = DEFAULT_BOOKING_CONFIG
  return {
    mode: BOOKING_MODES.includes(r.mode as BookingMode) ? (r.mode as BookingMode) : 'off',
    externalUrl: isSafeHttpsUrl(r.externalUrl) ? r.externalUrl : null,
    chatLinkTtlHours: resolveTtl(r.chatLinkTtlHours, d.chatLinkTtlHours as number),
    campaignLinkTtlHours: resolveTtl(r.campaignLinkTtlHours, d.campaignLinkTtlHours as number),
    maxPartySize: isPartyMax(r.maxPartySize) ? r.maxPartySize : d.maxPartySize,
    aiRoutingEnabled: r.aiRoutingEnabled === true,
    templateIds: resolveTemplateIds(r.templateIds),
    templateBodies: resolveTexts(r.templateBodies),
    templateCandidates: resolveTexts(r.templateCandidates),
    agentBooking: resolveAgentBooking(r.agentBooking),
  }
}

export type BookingSettingsErrors = Partial<
  Record<'mode' | 'externalUrl' | 'chatLinkTtlHours' | 'campaignLinkTtlHours' | 'maxPartySize' | 'form', string>
>

export type ParseBookingSettingsResult =
  | { ok: true; config: BookingConfig }
  | { ok: false; errors: BookingSettingsErrors }

const SETTINGS_FIELDS = ['mode', 'externalUrl', 'chatLinkTtlHours', 'campaignLinkTtlHours', 'maxPartySize']

function parseExternalUrl(raw: unknown, mode: BookingMode, errors: BookingSettingsErrors): string | null {
  const value = typeof raw === 'string' ? raw.trim() : raw
  if (value === undefined || value === null || value === '') {
    if (mode === 'external') errors.externalUrl = 'required'
    return null
  }
  if (!isSafeHttpsUrl(value)) {
    errors.externalUrl = 'invalid_https_url'
    return null
  }
  return value
}

function parseTtlField(raw: unknown, current: number | null, key: keyof BookingSettingsErrors, errors: BookingSettingsErrors) {
  if (raw === undefined) return current
  if (raw === null || isTtl(raw)) return raw
  errors[key] = 'invalid_ttl'
  return current
}

/**
 * BOOK-002 F1 C2: the settings form's own fields from `settings`, onto
 * `current` (the stored value at write time), so a save never writes back
 * template ids, edits or candidates it read earlier.
 */
export function applyBookingSettings(current: BookingConfig, settings: BookingConfig): BookingConfig {
  const { mode, externalUrl, chatLinkTtlHours, campaignLinkTtlHours, maxPartySize } = settings
  return { ...current, mode, externalUrl, chatLinkTtlHours, campaignLinkTtlHours, maxPartySize }
}

/** Validates an admin's booking settings save against the current config. */
export function parseBookingSettings(body: unknown, current: BookingConfig): ParseBookingSettingsResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: { form: 'invalid_body' } }
  const b = body as Record<string, unknown>
  const unknownKey = Object.keys(b).find((k) => !SETTINGS_FIELDS.includes(k))
  if (unknownKey) return { ok: false, errors: { form: `unknown_field:${unknownKey}` } }

  const errors: BookingSettingsErrors = {}
  const mode = BOOKING_MODES.includes(b.mode as BookingMode) ? (b.mode as BookingMode) : null
  if (!mode) errors.mode = 'invalid_mode'
  const externalUrl = parseExternalUrl(b.externalUrl, mode ?? 'off', errors)
  const chatLinkTtlHours = parseTtlField(b.chatLinkTtlHours, current.chatLinkTtlHours, 'chatLinkTtlHours', errors)
  const campaignLinkTtlHours = parseTtlField(b.campaignLinkTtlHours, current.campaignLinkTtlHours, 'campaignLinkTtlHours', errors)
  const maxPartySize = b.maxPartySize === undefined ? current.maxPartySize : b.maxPartySize
  if (!isPartyMax(maxPartySize)) errors.maxPartySize = 'invalid_party_size'

  if (Object.keys(errors).length > 0 || !mode) return { ok: false, errors }
  return {
    ok: true,
    config: { ...current, mode, externalUrl, chatLinkTtlHours, campaignLinkTtlHours, maxPartySize: maxPartySize as number },
  }
}

export type AgentBookingSettingsErrors = Partial<Record<'enabled' | 'websiteHost' | 'mode' | 'form', string>>

export type ParseAgentBookingSettingsResult =
  | { ok: true; agentBooking: AgentBookingConfig }
  | { ok: false; errors: AgentBookingSettingsErrors }

const AGENT_SETTINGS_FIELDS = ['enabled', 'websiteHost']

function parseHostField(raw: unknown, current: string | null, errors: AgentBookingSettingsErrors): string | null {
  if (raw === undefined) return current
  if (raw === null || raw === '') return null
  const host = normalizeWebsiteHost(raw)
  if (!host) errors.websiteHost = 'invalid_host'
  return host
}

/**
 * BOOK-003 (R43): an admin's agent booking save. Enabling needs Simple
 * booking and the website host (poppy.json is useless without its domain).
 * The first enable mints the public id with `newPublicId`; turning it off
 * keeps the id, so turning it back on restores the same poppy.json.
 */
export function parseAgentBookingSettings(
  body: unknown,
  current: BookingConfig,
  newPublicId: () => string
): ParseAgentBookingSettingsResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: { form: 'invalid_body' } }
  const b = body as Record<string, unknown>
  const unknownKey = Object.keys(b).find((k) => !AGENT_SETTINGS_FIELDS.includes(k))
  if (unknownKey) return { ok: false, errors: { form: `unknown_field:${unknownKey}` } }
  if (typeof b.enabled !== 'boolean') return { ok: false, errors: { enabled: 'invalid' } }

  const errors: AgentBookingSettingsErrors = {}
  const websiteHost = parseHostField(b.websiteHost, current.agentBooking.websiteHost, errors)
  if (b.enabled && current.mode !== 'simple') errors.mode = 'not_simple'
  if (b.enabled && !websiteHost && !errors.websiteHost) errors.websiteHost = 'required'
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const publicId = current.agentBooking.publicId ?? (b.enabled ? newPublicId() : null)
  return { ok: true, agentBooking: { enabled: b.enabled, publicId, websiteHost } }
}

/** BOOK-003: only the agent booking block, onto the stored config. */
export function applyAgentBookingSettings(current: BookingConfig, agentBooking: AgentBookingConfig): BookingConfig {
  return { ...current, agentBooking }
}

/** BOOK-003 (R43): a new public id; the old one stops resolving at once. */
export function rotateAgentPublicId(current: BookingConfig, newPublicId: string): BookingConfig {
  return { ...current, agentBooking: { ...current.agentBooking, publicId: newPublicId } }
}
