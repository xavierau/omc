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
 * Pure: no I/O, so the downloaded file and the served one are the same bytes.
 */
import { MAX_PENDING_PER_PHONE } from '@/domain/entities/booking-request'
import { NAME_MAX, NOTES_MAX } from './booking-submission'
import { sanitizeTemplateParam } from './booking-message'

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

function description(input: AgentOpenApiInput): string {
  const s = input.statement
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

function createBookingOperation(input: AgentOpenApiInput) {
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
            required: ['date', 'time', 'party_size', 'name', 'phone'],
            properties: {
              date: { type: 'string', format: 'date', description: 'YYYY-MM-DD, today or later in Hong Kong time.' },
              time: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'HH:MM, 24-hour, Hong Kong time.' },
              party_size: { type: 'integer', minimum: 1, maximum: input.maxPartySize },
              name: { type: 'string', minLength: 1, maxLength: NAME_MAX },
              phone: { type: 'string', pattern: '^\\+[1-9]\\d{7,14}$', description: "The diner's WhatsApp number in E.164, e.g. +85291234567." },
              notes: { type: 'string', maxLength: NOTES_MAX },
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
      '400': errorResponse('invalid_request: a field is missing or invalid, or an unknown field was sent.'),
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

// AGENT-003: the diner can cancel by chat with the restaurant's own AI agent.
const STATUS_ENUM = ['awaiting_confirmation', 'expired', 'pending', 'confirmed', 'declined', 'cancelled']

function schemas() {
  const statement = {
    type: 'object',
    required: ['en', 'zh-HK', 'privacy_url'],
    properties: { en: { type: 'string' }, 'zh-HK': { type: 'string' }, privacy_url: { type: 'string', format: 'uri' } },
  }
  return {
    Error: ERROR_SCHEMA,
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
  return {
    openapi: '3.1.0',
    info: { title: `${input.restaurantName} table booking`, version: '1.0.0', description: description(input) },
    servers: [{ url: input.apiBaseUrl }],
    // Signed out (PAP 7): no scheme is required on any operation.
    security: [],
    paths: {
      '/bookings': { post: createBookingOperation(input) },
      '/bookings/{booking_id}': { get: getBookingOperation() },
    },
    components: { schemas: schemas() },
  }
}
