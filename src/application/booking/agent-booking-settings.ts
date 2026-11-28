/**
 * BOOK-003 (R43): an admin turns agent booking on or off, sets the website
 * host, rotates the agent booking id and downloads the restaurant's
 * poppy.json. The routes enforce tenant admin; this module owns the rules.
 * Every write is a compare-and-swap on booking_config (BOOK-002 F1 C2) that
 * changes only `agentBooking`, so a concurrent settings or template write is
 * never lost.
 *
 * BOOK-014 W5 (spec AC-10): poppy.json and the OpenAPI document state the
 * deposit and its amount rule while the restaurant takes deposits (rule on
 * and an account that can take charges, as every channel decides, AC-4).
 */
import {
  applyAgentBookingSettings,
  parseAgentBookingSettings,
  rotateAgentPublicId,
  type AgentBookingSettingsErrors,
  type BookingConfig,
} from '@/domain/value-objects/booking-config'
import { buildAgentBookingOpenApi, buildCollectionStatement, buildPoppyJson } from '@/domain/services/poppy-documents'
import { hasConfirmableWhatsAppNumber } from '@/domain/services/agent-booking'
import { hongKongToday } from '@/domain/services/booking-submission'
import { bookingHoursInEffect, type BookingHours } from '@/domain/value-objects/booking-hours'
import type { BookingSettingsReader } from '@/domain/ports/booking'
import type { MerchantPaymentAccountReader } from '@/domain/ports/booking-deposit'
import { isChargeable } from '@/domain/entities/merchant-payment-account'
import { sanitizeTemplateParam } from '@/domain/services/booking-message'
import { depositTermsText } from '@/domain/value-objects/deposit-terms'
import { depositProcessingSentence } from '@/domain/value-objects/deposit-messages'
import type { DepositRule } from '@/domain/value-objects/deposit-rule'
import type { AgentBookingSecrets } from './agent-booking-secrets'

export type ConfigChange = (current: BookingConfig) => BookingConfig | null

export interface AgentBookingSettingsDeps {
  getConfig(restaurantId: string): Promise<BookingConfig>
  changeConfig(restaurantId: string, change: ConfigChange): Promise<BookingConfig | null>
  settings: Pick<BookingSettingsReader, 'getRestaurant'>
  secrets: Pick<AgentBookingSecrets, 'publicId'>
  /** NEXT_PUBLIC_APP_URL, the host of the agent API, checked by resolveAgentAppUrl; null when unusable. */
  appUrl: string | null
  /** BOOK-014 W5: the restaurant's payment account; absent = the documents never mention a deposit. */
  accounts?: MerchantPaymentAccountReader
}

/**
 * BOOK-014 W5: the deposit the documents state, or null (no reader, rule off,
 * account not chargeable). W6a: the PAP create response's collection
 * statement asks the same question (createAgentBooking).
 */
export async function documentDeposit(
  accounts: MerchantPaymentAccountReader | undefined,
  restaurantId: string,
  rule: DepositRule | undefined,
  restaurantName: string
) {
  if (!accounts || !rule?.enabled) return null
  const account = await accounts.findForRestaurant(restaurantId)
  if (!isChargeable(account)) return null
  const terms = depositTermsText(rule, account.currency, 'en')
  if (!terms) return null
  return { terms, processing: depositProcessingSentence(sanitizeTemplateParam(restaurantName) || 'the restaurant') }
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
  | { ok: false; reason: 'not_enabled' | 'no_whatsapp_number' }

/**
 * The file the restaurant hosts at https://{websiteHost}/.well-known/poppy.json.
 * Refused whenever the agent API would answer 404: not_enabled per
 * resolveAgentBookingTenant, including a booking mode other than Simple
 * (review F7); no_whatsapp_number when the diner could not confirm
 * (createAgentBooking's contextFor, review G2).
 */
export async function generatePoppyJson(deps: AgentBookingSettingsDeps, restaurantId: string): Promise<PoppyJsonResult> {
  const { mode, agentBooking, deposit: rule } = await deps.getConfig(restaurantId)
  if (mode !== 'simple' || !agentBooking.enabled || !agentBooking.publicId || !agentBooking.websiteHost) {
    return { ok: false, reason: 'not_enabled' }
  }
  const openApiUrl = `${agentApiBaseUrl(deps.appUrl, agentBooking.publicId)}/openapi.json`
  const restaurant = await deps.settings.getRestaurant(restaurantId)
  if (!restaurant || !hasConfirmableWhatsAppNumber(restaurant.whatsappNumber)) return { ok: false, reason: 'no_whatsapp_number' }
  const deposit = await documentDeposit(deps.accounts, restaurantId, rule, restaurant.name)
  return {
    ok: true,
    document: buildPoppyJson({
      restaurantName: restaurant.name,
      websiteHost: agentBooking.websiteHost,
      openApiUrl,
      ...(deposit ? { depositTerms: deposit.terms } : {}),
    }),
  }
}

export interface AgentOpenApiDeps {
  settings: Pick<BookingSettingsReader, 'getRestaurant'>
  /** As AgentBookingSettingsDeps.appUrl. */
  appUrl: string | null
  privacyUrl: string
  /** BOOK-009: Hong Kong today bounds the special dates the description lists (read only when hours are set). */
  now(): Date
  /** BOOK-014 W5: as AgentBookingSettingsDeps.accounts. */
  accounts?: MerchantPaymentAccountReader
}

/** The OpenAPI 3.1 description for one tenant (the caller resolved the tenant). */
export async function agentOpenApiFor(
  deps: AgentOpenApiDeps,
  tenant: { restaurantId: string; publicId: string; maxPartySize: number; bookingHours?: BookingHours | null; deposit?: DepositRule }
) {
  const apiBaseUrl = agentApiBaseUrl(deps.appUrl, tenant.publicId)
  // F1 (P2-1, AC-5): hours with no effect (schedule off, no terms/info/table time) give the pre-BOOK-009 document.
  const hours = bookingHoursInEffect(tenant.bookingHours)
  const name = (await deps.settings.getRestaurant(tenant.restaurantId))?.name ?? ''
  return buildAgentBookingOpenApi({
    restaurantName: name,
    apiBaseUrl,
    maxPartySize: tenant.maxPartySize,
    statement: buildCollectionStatement(name, deps.privacyUrl),
    booking: hours ? { hours, today: hongKongToday(deps.now()) } : null,
    deposit: await documentDeposit(deps.accounts, tenant.restaurantId, tenant.deposit, name),
  })
}
