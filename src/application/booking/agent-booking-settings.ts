/**
 * BOOK-003 (R43): an admin turns agent booking on or off, sets the website
 * host, rotates the agent booking id and downloads the restaurant's
 * poppy.json. The routes enforce tenant admin; this module owns the rules.
 * Every write is a compare-and-swap on booking_config (BOOK-002 F1 C2) that
 * changes only `agentBooking`, so a concurrent settings or template write is
 * never lost.
 */
import {
  applyAgentBookingSettings,
  parseAgentBookingSettings,
  rotateAgentPublicId,
  type AgentBookingSettingsErrors,
  type BookingConfig,
} from '@/domain/value-objects/booking-config'
import { buildAgentBookingOpenApi, buildCollectionStatement, buildPoppyJson } from '@/domain/services/poppy-documents'
import type { BookingSettingsReader } from '@/domain/ports/booking'
import type { AgentBookingSecrets } from './agent-booking-secrets'

export type ConfigChange = (current: BookingConfig) => BookingConfig | null

export interface AgentBookingSettingsDeps {
  getConfig(restaurantId: string): Promise<BookingConfig>
  changeConfig(restaurantId: string, change: ConfigChange): Promise<BookingConfig | null>
  settings: Pick<BookingSettingsReader, 'getRestaurant'>
  secrets: Pick<AgentBookingSecrets, 'publicId'>
  /** NEXT_PUBLIC_APP_URL, the host of the agent API, checked by resolveAgentAppUrl; null when unusable. */
  appUrl: string | null
}

export type SaveAgentBookingResult =
  | { ok: true; config: BookingConfig }
  | { ok: false; reason: 'invalid'; errors: AgentBookingSettingsErrors }

export async function saveAgentBookingSettings(
  deps: AgentBookingSettingsDeps,
  restaurantId: string,
  body: unknown
): Promise<SaveAgentBookingResult> {
  const parsed = parseAgentBookingSettings(body, await deps.getConfig(restaurantId), deps.secrets.publicId)
  if (!parsed.ok) return { ok: false, reason: 'invalid', errors: parsed.errors }
  const next = await deps.changeConfig(restaurantId, (current) =>
    // An id rotated since the read wins over the one this save read.
    applyAgentBookingSettings(current, { ...parsed.agentBooking, publicId: current.agentBooking.publicId ?? parsed.agentBooking.publicId })
  )
  return { ok: true, config: next ?? (await deps.getConfig(restaurantId)) }
}

export async function rotateAgentBookingId(deps: AgentBookingSettingsDeps, restaurantId: string): Promise<BookingConfig> {
  const id = deps.secrets.publicId()
  return (await deps.changeConfig(restaurantId, (current) => rotateAgentPublicId(current, id))) ?? deps.getConfig(restaurantId)
}

/** Thrown when NEXT_PUBLIC_APP_URL cannot anchor absolute agent URLs; routes answer 500 and log its name. */
export class AgentAppUrlError extends Error {
  constructor() {
    super('NEXT_PUBLIC_APP_URL is empty or not https')
    this.name = 'AgentAppUrlError'
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Review F6: poppy.json and the OpenAPI document must carry absolute https
 * URLs. Empty, relative or non-https → null; http only for localhost outside
 * production (local dev).
 */
export function resolveAgentAppUrl(raw: string | undefined, nodeEnv: string | undefined): string | null {
  const value = raw?.trim() ?? ''
  if (value === '') return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (!url.hostname || url.username || url.password) return null
  const localHttp = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname) && nodeEnv !== 'production'
  if (url.protocol !== 'https:' && !localHttp) return null
  return value.replace(/\/+$/, '')
}

export function agentApiBaseUrl(appUrl: string | null, publicId: string): string {
  if (!appUrl) throw new AgentAppUrlError()
  return `${appUrl.replace(/\/+$/, '')}/api/poppy/${publicId}`
}

export type PoppyJsonResult =
  | { ok: true; document: ReturnType<typeof buildPoppyJson> }
  | { ok: false; reason: 'not_enabled' }

/**
 * The file the restaurant hosts at https://{websiteHost}/.well-known/poppy.json.
 * not_enabled whenever the agent API would answer 404 (resolveAgentBookingTenant),
 * including a booking mode other than Simple (review F7).
 */
export async function generatePoppyJson(deps: AgentBookingSettingsDeps, restaurantId: string): Promise<PoppyJsonResult> {
  const { mode, agentBooking } = await deps.getConfig(restaurantId)
  if (mode !== 'simple' || !agentBooking.enabled || !agentBooking.publicId || !agentBooking.websiteHost) {
    return { ok: false, reason: 'not_enabled' }
  }
  const openApiUrl = `${agentApiBaseUrl(deps.appUrl, agentBooking.publicId)}/openapi.json`
  const restaurant = await deps.settings.getRestaurant(restaurantId)
  return {
    ok: true,
    document: buildPoppyJson({
      restaurantName: restaurant?.name ?? '',
      websiteHost: agentBooking.websiteHost,
      openApiUrl,
    }),
  }
}

export interface AgentOpenApiDeps {
  settings: Pick<BookingSettingsReader, 'getRestaurant'>
  /** As AgentBookingSettingsDeps.appUrl. */
  appUrl: string | null
  privacyUrl: string
}

/** The OpenAPI 3.1 description for one tenant (the caller resolved the tenant). */
export async function agentOpenApiFor(
  deps: AgentOpenApiDeps,
  tenant: { restaurantId: string; publicId: string; maxPartySize: number }
) {
  const apiBaseUrl = agentApiBaseUrl(deps.appUrl, tenant.publicId)
  const name = (await deps.settings.getRestaurant(tenant.restaurantId))?.name ?? ''
  return buildAgentBookingOpenApi({
    restaurantName: name,
    apiBaseUrl,
    maxPartySize: tenant.maxPartySize,
    statement: buildCollectionStatement(name, deps.privacyUrl),
  })
}
