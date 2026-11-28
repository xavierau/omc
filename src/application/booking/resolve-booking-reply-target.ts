/**
 * BOOK-001 W2 (spec AC-5, R11): where a chat Book now reply points.
 *
 * Simple → `${appUrl}/b/<token>`, reusing the sender's live chat link before
 * minting a new one, so a repeated BOOK never leaves several live links.
 * External → the restaurant's URL (no token). Off, or any part missing →
 * null, and the caller falls back to today's reply.
 */
import { buildBookingLinkUrl } from '@/domain/services/booking-intent'
import type { BookingConfig } from '@/domain/value-objects/booking-config'

export interface ChatTokenSource {
  /** A live chat link worth reusing (no expiry or ≥ 1h left, F5), else null. */
  findLiveChatToken(restaurantId: string, phone: string): Promise<string | null>
  /** A `chat` token; `ttlHours` null = no expiry. Returns null on failure. */
  mint(input: { restaurantId: string; phone: string; ttlHours: number | null }): Promise<string | null>
}

export interface BookingReplyTarget {
  mode: 'simple' | 'external'
  url: string
}

export interface BookingReplyTargetDeps {
  tokens: ChatTokenSource
  appUrl: string | undefined
}

export interface BookingReplyTargetInput {
  restaurantId: string
  phone: string
  config: BookingConfig
}

export async function resolveBookingReplyTarget(
  deps: BookingReplyTargetDeps,
  input: BookingReplyTargetInput
): Promise<BookingReplyTarget | null> {
  const { config } = input
  if (config.mode === 'external') {
    return config.externalUrl ? { mode: 'external', url: config.externalUrl } : null
  }
  if (config.mode !== 'simple' || !deps.appUrl) return null

  const token = await chatToken(deps.tokens, input)
  const url = token ? buildBookingLinkUrl(deps.appUrl, token) : null
  return url ? { mode: 'simple', url } : null
}

async function chatToken(tokens: ChatTokenSource, input: BookingReplyTargetInput): Promise<string | null> {
  const live = await tokens.findLiveChatToken(input.restaurantId, input.phone)
  if (live) return live
  return tokens.mint({
    restaurantId: input.restaurantId,
    phone: input.phone,
    ttlHours: input.config.chatLinkTtlHours,
  })
}
