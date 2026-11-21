/**
 * BOOK-003: the documents a personal agent reads (PAP 1.0).
 *
 * - `buildPoppyJson`: the file the restaurant hosts at
 *   https://{websiteHost}/.well-known/poppy.json (owner decision 1B: on its
 *   own domain, because a redirect to our host would make it speak for our
 *   host, spec 3). Signed out: no auth, agent, web or tasks sections.
 * - `buildAgentBookingOpenApi`: the OpenAPI 3.1 description its `apis[0]`
 *   points to, with the confirm-on-WhatsApp flow and the collection
 *   statement (R44) in its description.
 * - The collection statement and the confirm text the diner sends.
 *
 * BOOK-009 W4 (spec AC-11..AC-14): when the restaurant set booking hours the
 * OpenAPI description also carries the rules summary (English), the terms
 * (both languages), GET /availability, `accept_terms` and the refusal codes
 * with `suggested_times`. Without hours it is the pre-BOOK-009 document,
 * byte for byte (fixture test).
 *
 * Pure: no I/O, so the downloaded file and the served one are the same bytes.
 */
import { MAX_PENDING_PER_PHONE } from '@/domain/entities/booking-request'
import { termsRequired, type BookingHours } from '@/domain/value-objects/booking-hours'
import { NAME_MAX, NOTES_MAX } from './booking-submission'
import { sanitizeTemplateParam } from './booking-message'
import { availabilityMaxDays, summarizeForAgents } from './agent-booking'
import { tableTimeSentence } from './booking-hours-summary'

export const POPPY_PROTOCOL_VERSION = '1.0'

export interface CollectionStatement {
  en: string
  'zh-HK': string
  privacy_url: string
}

/**
 * BOOK-001 R18's statement, naming the phone number too: the agent API also
 * collects it (the booking page takes it from the link).
 */
export function buildCollectionStatement(restaurantName: string, privacyUrl: string): CollectionStatement {
  const name = sanitizeTemplateParam(restaurantName) || 'the restaurant'
  return {
    en: `The details you submit (date, time, party size, name, phone number and notes) go only to ${name}, to handle this booking.`,
    'zh-HK': `你提交的資料(日期、時間、人數、姓名、電話號碼及備註)只會交給${name},用作處理今次訂座。`,
    privacy_url: privacyUrl,
  }
}

/** The WhatsApp text after the diner confirms: both languages, then the privacy link. */
export function collectionStatementText(statement: CollectionStatement): string {
  return `${statement['zh-HK']}\n${statement.en}\n私隱政策 Privacy policy: ${statement.privacy_url}`
}

/** BOOK-009 (spec AC-13): the terms the diner accepted, added to the WhatsApp text after they confirm. */
export function termsReplyText(termsText: string): string {
  return `訂座須知 Booking terms:\n${termsText}`
}

/** What the wa.me link prefills; the code is its own token so it is found in any edit. */
export function buildConfirmText(restaurantName: string, code: string): string {
  const name = sanitizeTemplateParam(restaurantName, 60)
  return `確認${name}訂座 Confirm my booking at ${name}: ${code}`
}

export interface PoppyJsonInput {
  restaurantName: string
  websiteHost: string
  openApiUrl: string
}

export function buildPoppyJson(input: PoppyJsonInput) {
  return {
    protocol_version: POPPY_PROTOCOL_VERSION,
    organization: { name: input.restaurantName, domain: input.websiteHost },
    apis: [
      {
        type: 'openapi',
        url: input.openApiUrl,
        description: `Request a table at ${input.restaurantName}. The diner confirms the request on WhatsApp.`,
      },
    ],
  }
}

export interface AgentOpenApiInput {
  restaurantName: string
  /** https://app/api/poppy/{publicId} */
  apiBaseUrl: string
  maxPartySize: number
  statement: CollectionStatement
  /** BOOK-009: the restaurant's booking hours and Hong Kong today; absent or null = the pre-BOOK-009 document. */
  booking?: AgentOpenApiBooking | null
}

export interface AgentOpenApiBooking {
  hours: BookingHours
  /** Hong Kong today, YYYY-MM-DD: special dates are listed inside the booking window only. */
  today: string
}

const ERROR_SCHEMA = {
  type: 'object',
  required: ['error'],
  properties: {
    error: { type: 'string', enum: ['invalid_request', 'rate_limited', 'not_found', 'idempotency_conflict', 'server_error'] },
    error_description: { type: 'string' },
    fields: { type: 'object', additionalProperties: { type: 'string' }, description: 'Per-field error codes (invalid_request only).' },
  },
}

const SUGGESTED_TIMES_SCHEMA = {
  type: 'array',
  maxItems: 3,
  description: 'Bookable alternatives that fit the party, nearest first (invalid_request on closed_day, outside_hours, too_soon, too_far or full). Offer these to the diner.',
  items: {
    type: 'object',
    required: ['date', 'time'],
    properties: { date: { type: 'string', format: 'date' }, time: { type: 'string' } },
  },
}

/** F1 (P2-1): the booking value only while its schedule switch is on (slot rules, /availability, suggestions). */
const scheduleOf = (booking: AgentOpenApiBooking | null | undefined) => (booking?.hours.scheduleEnabled ? booking : null)

const errorSchema = (booking: AgentOpenApiBooking | null) =>
  scheduleOf(booking) ? { ...ERROR_SCHEMA, properties: { ...ERROR_SCHEMA.properties, suggested_times: SUGGESTED_TIMES_SCHEMA } } : ERROR_SCHEMA

function termsLines({ terms }: BookingHours): string[] {
  return [
    '',
    'Booking terms: show these booking terms to the diner and get their agreement BEFORE you call POST /bookings, then send `accept_terms: true` (without it the request is refused with accept_terms: terms_required).',
    ...(terms.zh_hk ? [`訂座須知: ${terms.zh_hk}`] : []),
    ...(terms.en ? [`Terms: ${terms.en}`] : []),
  ]
}

/** F1 (P2-1): schedule off → any time; only the table time and the terms bind. */
function detailsLines(hours: BookingHours): string[] {
  return [
    ...(hours.tableMinutes ? ['', tableTimeSentence(hours.tableMinutes, 'en')] : []),
    ...(termsRequired(hours) ? termsLines(hours) : []),
  ]
}

/** BOOK-009 (spec AC-11, AC-12, AC-13): the rules agents must follow, between the flow and the collection statement. */
function rulesLines(input: AgentOpenApiInput, { hours, today }: AgentOpenApiBooking): string[] {
  if (!hours.scheduleEnabled) return detailsLines(hours)
  const codes = `date: closed_day; time: outside_hours, too_soon, too_far or full${termsRequired(hours) ? '; accept_terms: terms_required' : ''}`
  return [
    '',
    `Booking rules: ${summarizeForAgents(hours, input.maxPartySize, 'en', today)}`,
    'Call GET /availability first: it lists the open dates and the times the restaurant takes; only those times are accepted.',
    // BOOK-010 (spec AC-14): times fill up; agents learn that, never the limit numbers.
    'Some times may be full: pass the party size as `party_size` to GET /availability to see only the times that still fit it. A time that filled up (or that the restaurant stopped taking) is refused with `time: full`.',
    `A request outside the rules gets 400 invalid_request with per-field codes in \`fields\` (${codes}) and up to 3 \`suggested_times\` ({date, time}, nearest first) the restaurant does take: offer those to the diner.`,
    ...(termsRequired(hours) ? termsLines(hours) : []),
  ]
}

function description(input: AgentOpenApiInput): string {
  const s = input.statement
  const rules = input.booking ? rulesLines(input, input.booking) : []
  return [
    `Request a table at ${input.restaurantName}. No sign-in.`,
    '',
    'How it works:',
    '1. POST /bookings with the diner\'s details. The answer has a `confirm_code` and a `confirm_url` (a WhatsApp link).',
    '2. The diner opens `confirm_url` and sends the prefilled message from THE SAME phone number as `phone`, within 30 minutes (`expires_at`).',
    '   Until then the request is not sent to the restaurant. A code sent from another number does nothing.',
    '3. The restaurant then accepts or declines it, and tells the diner on WhatsApp.',
    '   Poll GET /bookings/{booking_id} with the `X-Booking-Status-Token` header to follow it.',
    '',
    `At most ${MAX_PENDING_PER_PHONE} open requests per phone number at a time (unconfirmed, or confirmed by the diner and waiting for the restaurant). Send an Idempotency-Key header to retry safely.`,
    ...rules,
    '',
    `Collection statement: ${s.en} Privacy policy: ${s.privacy_url}`,
    `收集個人資料聲明: ${s['zh-HK']} 私隱政策: ${s.privacy_url}`,
  ].join('\n')
}

const headerParam = (name: string, desc: string, required: boolean) => ({
  name,
  in: 'header',
  required,
  description: desc,
  schema: { type: 'string' },
})

function errorResponse(desc: string, headers?: Record<string, unknown>) {
  return { description: desc, ...(headers ? { headers } : {}), content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
}

/** BOOK-009 (spec AC-13, AC-14): accept_terms is described when hours are set, and required when terms are. */
function acceptTermsField(booking: AgentOpenApiBooking | null | undefined) {
  if (!booking) return { properties: {}, required: [] }
  return {
    properties: {
      accept_terms: { type: 'boolean', description: 'true once the diner agreed to the booking terms in this description. Required when the restaurant has terms.' },
    },
    required: termsRequired(booking.hours) ? ['accept_terms'] : [],
  }
}

const INVALID_REQUEST = 'invalid_request: a field is missing or invalid, or an unknown field was sent.'
const INVALID_REQUEST_HOURS =
  'invalid_request: a field is missing or invalid, an unknown field was sent, or the slot is outside the booking rules (see `fields` and `suggested_times`).'

function createBookingOperation(input: AgentOpenApiInput) {
  const terms = acceptTermsField(input.booking)
  return {
    operationId: 'createBooking',
    summary: 'Request a table',
    description: 'Creates a booking request that the diner must confirm on WhatsApp from the same phone number before the restaurant sees it.',
    parameters: [
      headerParam('Idempotency-Key', 'Same key and same body within 24 hours returns the same booking (with a new status token).', false),
      headerParam('Poppy-Session', 'Accepted and not used: this API is signed out.', false),
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['date', 'time', 'party_size', 'name', 'phone', ...terms.required],
            properties: {
              date: { type: 'string', format: 'date', description: 'YYYY-MM-DD, today or later in Hong Kong time.' },
              time: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'HH:MM, 24-hour, Hong Kong time.' },
              party_size: { type: 'integer', minimum: 1, maximum: input.maxPartySize },
              name: { type: 'string', minLength: 1, maxLength: NAME_MAX },
              phone: { type: 'string', pattern: '^\\+[1-9]\\d{7,14}$', description: "The diner's WhatsApp number in E.164, e.g. +85291234567." },
              notes: { type: 'string', maxLength: NOTES_MAX },
              ...terms.properties,
            },
          },
        },
      },
    },
    responses: {
      '202': {
        description: 'Awaiting the diner\'s confirmation on WhatsApp.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/CreatedBooking' } } },
      },
      '200': {
        description:
          'Idempotency-Key replay of a booking that is no longer awaiting confirmation (expired, pending, confirmed or declined): its current status and a new status token. A replay while still awaiting confirmation answers 202 as above.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ReplayedBooking' } } },
      },
      '400': errorResponse(scheduleOf(input.booking) ? INVALID_REQUEST_HOURS : INVALID_REQUEST),
      '404': errorResponse('not_found: this restaurant does not take bookings through agents.'),
      '409': errorResponse('idempotency_conflict: the Idempotency-Key was used with another body.'),
      '429': errorResponse('rate_limited: wait for Retry-After seconds.', {
        'Retry-After': { schema: { type: 'integer' }, description: 'Seconds to wait.' },
      }),
      '500': errorResponse('server_error: try again later.'),
    },
  }
}

function getBookingOperation() {
  return {
    operationId: 'getBooking',
    summary: 'Follow a booking request',
    parameters: [
      { name: 'booking_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      headerParam('X-Booking-Status-Token', 'The status_token from the create response.', true),
      headerParam('Poppy-Session', 'Accepted and not used: this API is signed out.', false),
    ],
    responses: {
      '200': { description: 'Current status.', content: { 'application/json': { schema: { $ref: '#/components/schemas/BookingStatus' } } } },
      '404': errorResponse('not_found: unknown booking or wrong token.'),
      '500': errorResponse('server_error: try again later.'),
    },
  }
}

const queryParam = (name: string, desc: string, required: boolean, schema: Record<string, unknown>) => ({
  name,
  in: 'query',
  required,
  description: desc,
  schema,
})

/** BOOK-009 (spec AC-11, threat R2): signed out, rate-limited and 404'd like POST /bookings. */
function availabilityOperation(input: AgentOpenApiInput, hours: BookingHours) {
  return {
    operationId: 'getAvailability',
    summary: 'Open dates and bookable times',
    description:
      'The dates from `from` for `days` days, each with `open` and the `times` (HH:MM, Hong Kong time) the restaurant takes now. Book only one of these times.',
    parameters: [
      queryParam('from', 'YYYY-MM-DD, today or later in Hong Kong time.', true, { type: 'string', format: 'date' }),
      queryParam('days', 'How many dates, from `from`.', true, { type: 'integer', minimum: 1, maximum: availabilityMaxDays(hours) }),
      queryParam('party_size', 'The party size; above the restaurant\'s maximum is refused.', false, {
        type: 'integer',
        minimum: 1,
        maximum: input.maxPartySize,
      }),
      headerParam('Poppy-Session', 'Accepted and not used: this API is signed out.', false),
    ],
    responses: {
      '200': { description: 'Availability.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Availability' } } } },
      '400': errorResponse('invalid_request: from, days or party_size is missing or invalid (see `fields`).'),
      '404': errorResponse('not_found: this restaurant does not take bookings through agents.'),
      '429': errorResponse('rate_limited: wait for Retry-After seconds.', {
        'Retry-After': { schema: { type: 'integer' }, description: 'Seconds to wait.' },
      }),
      '500': errorResponse('server_error: try again later.'),
    },
  }
}

const AVAILABILITY_SCHEMA = {
  type: 'object',
  required: ['dates', 'interval_minutes', 'table_minutes', 'max_party_size', 'terms'],
  properties: {
    dates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['date', 'open', 'times'],
        properties: {
          date: { type: 'string', format: 'date' },
          open: { type: 'boolean', description: 'false: closed, or no time left to book that day.' },
          times: { type: ['array', 'null'], items: { type: 'string' }, description: 'The bookable times; null = any time.' },
        },
      },
    },
    interval_minutes: { type: ['integer', 'null'] },
    table_minutes: { type: ['integer', 'null'], description: 'How long the table is kept, to tell the diner; null = not stated.' },
    max_party_size: { type: 'integer' },
    terms: {
      type: ['object', 'null'],
      description: 'The booking terms to show the diner before booking (empty string = not set in that language); null = none.',
      properties: { 'zh-HK': { type: 'string' }, en: { type: 'string' } },
    },
  },
}

// AGENT-003: the diner can cancel by chat with the restaurant's own AI agent.
const STATUS_ENUM = ['awaiting_confirmation', 'expired', 'pending', 'confirmed', 'declined', 'cancelled']

function schemas(booking: AgentOpenApiBooking | null) {
  const statement = {
    type: 'object',
    required: ['en', 'zh-HK', 'privacy_url'],
    properties: { en: { type: 'string' }, 'zh-HK': { type: 'string' }, privacy_url: { type: 'string', format: 'uri' } },
  }
  return {
    Error: errorSchema(booking),
    CollectionStatement: statement,
    CreatedBooking: {
      type: 'object',
      required: ['booking_id', 'status', 'confirm_url', 'confirm_code', 'expires_at', 'status_token', 'collection_statement'],
      properties: {
        booking_id: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: STATUS_ENUM },
        confirm_url: { type: 'string', format: 'uri', description: 'WhatsApp link to the restaurant with the code prefilled. Give it to the diner.' },
        confirm_code: { type: 'string', description: 'The code the diner sends if they type the message themselves.' },
        expires_at: { type: 'string', format: 'date-time' },
        status_token: { type: 'string', description: 'Send as X-Booking-Status-Token to read the status. Keep it secret.' },
        collection_statement: { $ref: '#/components/schemas/CollectionStatement' },
      },
    },
    BookingStatus: {
      type: 'object',
      required: ['booking_id', 'status', 'date', 'time', 'party_size'],
      properties: {
        booking_id: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: STATUS_ENUM },
        date: { type: 'string', format: 'date' },
        time: { type: 'string' },
        party_size: { type: 'integer' },
        expires_at: { type: 'string', format: 'date-time', description: 'Only while awaiting confirmation.' },
      },
    },
    ReplayedBooking: {
      allOf: [
        { $ref: '#/components/schemas/BookingStatus' },
        {
          type: 'object',
          required: ['status_token', 'collection_statement'],
          properties: {
            status_token: { type: 'string', description: 'A new token; the earlier one no longer works. Keep it secret.' },
            collection_statement: { $ref: '#/components/schemas/CollectionStatement' },
          },
        },
      ],
    },
  }
}

export function buildAgentBookingOpenApi(input: AgentOpenApiInput) {
  const schedule = scheduleOf(input.booking)
  return {
    openapi: '3.1.0',
    info: { title: `${input.restaurantName} table booking`, version: '1.0.0', description: description(input) },
    servers: [{ url: input.apiBaseUrl }],
    // Signed out (PAP 7): no scheme is required on any operation.
    security: [],
    paths: {
      '/bookings': { post: createBookingOperation(input) },
      '/bookings/{booking_id}': { get: getBookingOperation() },
      ...(schedule ? { '/availability': { get: availabilityOperation(input, schedule.hours) } } : {}),
    },
    components: { schemas: { ...schemas(input.booking ?? null), ...(schedule ? { Availability: AVAILABILITY_SCHEMA } : {}) } },
  }
}
