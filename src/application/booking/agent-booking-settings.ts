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
  /** NEXT_PUBLIC_APP_URL, the host of the agent API. */
  appUrl: string
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

export function agentApiBaseUrl(appUrl: string, publicId: string): string {
  return `${appUrl.replace(/\/+$/, '')}/api/poppy/${publicId}`
}

export type PoppyJsonResult =
  | { ok: true; document: ReturnType<typeof buildPoppyJson> }
  | { ok: false; reason: 'not_enabled' }

/** The file the restaurant hosts at https://{websiteHost}/.well-known/poppy.json. */
export async function generatePoppyJson(deps: AgentBookingSettingsDeps, restaurantId: string): Promise<PoppyJsonResult> {
  const { agentBooking } = await deps.getConfig(restaurantId)
  if (!agentBooking.enabled || !agentBooking.publicId || !agentBooking.websiteHost) return { ok: false, reason: 'not_enabled' }
  const restaurant = await deps.settings.getRestaurant(restaurantId)
  return {
    ok: true,
    document: buildPoppyJson({
      restaurantName: restaurant?.name ?? '',
      websiteHost: agentBooking.websiteHost,
      openApiUrl: `${agentApiBaseUrl(deps.appUrl, agentBooking.publicId)}/openapi.json`,
    }),
  }
}

export interface AgentOpenApiDeps {
  settings: Pick<BookingSettingsReader, 'getRestaurant'>
  appUrl: string
  privacyUrl: string
}

/** The OpenAPI 3.1 description for one tenant (the caller resolved the tenant). */
export async function agentOpenApiFor(
  deps: AgentOpenApiDeps,
  tenant: { restaurantId: string; publicId: string; maxPartySize: number }
) {
  const name = (await deps.settings.getRestaurant(tenant.restaurantId))?.name ?? ''
  return buildAgentBookingOpenApi({
    restaurantName: name,
    apiBaseUrl: agentApiBaseUrl(deps.appUrl, tenant.publicId),
    maxPartySize: tenant.maxPartySize,
    statement: buildCollectionStatement(name, deps.privacyUrl),
  })
}
