/**
 * BOOK-001: personal booking links (`booking_tokens`, migration 082).
 *
 * Copies the contact-form token pattern (contact-form-token-repository.ts):
 * a stored 256-bit capability, peeked on page load, claimed atomically on
 * submit. Differences: `expires_at` may be NULL (no expiry), and a claim can
 * be released when the booking insert after it fails, so a database blip does
 * not burn the diner's only link.
 */
import { randomBytes } from 'crypto'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  BOOKING_TOKEN_BYTES,
  bookingTokenExpiry,
  bookingTokenState,
  isWellFormedBookingToken,
  type BookingLinkSource,
} from '@/domain/services/booking-token'
import type { BookingTokenOwner, BookingTokenStore } from '@/domain/ports/booking'

/** 256 bits, base64url: 43 URL-safe characters (R1). */
export function generateBookingToken(): string {
  return randomBytes(BOOKING_TOKEN_BYTES).toString('base64url')
}

interface TokenRow {
  restaurant_id: string
  phone: string
  source: BookingLinkSource
  campaign_id: string | null
  expires_at: string | null
  consumed_at: string | null
}

const toOwner = (row: Pick<TokenRow, 'restaurant_id' | 'phone' | 'source' | 'campaign_id'>): BookingTokenOwner => ({
  restaurantId: row.restaurant_id,
  phone: row.phone,
  source: row.source,
  campaignId: row.campaign_id,
})

export interface MintBookingTokenInput {
  restaurantId: string
  phone: string
  source: BookingLinkSource
  campaignId: string | null
  ttlHours: number | null
  now?: Date
}

/** Returns null on failure: callers (webhook, campaign send) degrade, never throw. */
export async function mintBookingToken(input: MintBookingTokenInput): Promise<string | null> {
  try {
    const supabase = createServerSupabaseClient()
    const token = generateBookingToken()
    const { error } = await supabase.from('booking_tokens').insert({
      token,
      restaurant_id: input.restaurantId,
      phone: input.phone,
      source: input.source,
      campaign_id: input.campaignId,
      expires_at: bookingTokenExpiry(input.now ?? new Date(), input.ttlHours),
    })
    if (error) {
      console.warn('[Booking] token mint failed:', error.message)
      return null
    }
    return token
  } catch (err) {
    console.warn('[Booking] token mint threw:', (err as Error).message)
    return null
  }
}

/** Fails closed to `unknown`, which renders the recovery page, never a form. */
export async function peekBookingToken(token: string, now: Date = new Date()) {
  if (!isWellFormedBookingToken(token)) return { state: 'unknown' as const, owner: null }
  try {
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase
      .from('booking_tokens')
      .select('restaurant_id, phone, source, campaign_id, expires_at, consumed_at')
      .eq('token', token)
      .maybeSingle()
    if (error || !data) return { state: 'unknown' as const, owner: null }
    const row = data as TokenRow
    const state = bookingTokenState({ expiresAt: row.expires_at, consumedAt: row.consumed_at }, now)
    return { state, owner: toOwner(row) }
  } catch (err) {
    console.warn('[Booking] token peek threw:', (err as Error).message)
    return { state: 'unknown' as const, owner: null }
  }
}

/**
 * The single point that makes a link single-use (R1): a conditional UPDATE
 * (`consumed_at IS NULL` and not expired, NULL expiry allowed) that only one
 * concurrent caller can win. Expiry is re-checked here, not just on page load.
 */
export async function claimBookingToken(token: string, now: Date = new Date()): Promise<BookingTokenOwner | null> {
  if (!isWellFormedBookingToken(token)) return null
  try {
    const supabase = createServerSupabaseClient()
    const nowIso = now.toISOString()
    const { data, error } = await supabase
      .from('booking_tokens')
      .update({ consumed_at: nowIso })
      .eq('token', token)
      .is('consumed_at', null)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .select('restaurant_id, phone, source, campaign_id')
      .maybeSingle()
    if (error || !data) return null
    return toOwner(data as TokenRow)
  } catch (err) {
    console.warn('[Booking] token claim threw:', (err as Error).message)
    return null
  }
}

/** Re-arms a token only if it is still the claim this caller made. */
export async function releaseBookingToken(token: string, claimedAt: Date): Promise<void> {
  try {
    const supabase = createServerSupabaseClient()
    const { error } = await supabase
      .from('booking_tokens')
      .update({ consumed_at: null })
      .eq('token', token)
      .eq('consumed_at', claimedAt.toISOString())
    if (error) console.warn('[Booking] token release failed:', error.message)
  } catch (err) {
    console.warn('[Booking] token release threw:', (err as Error).message)
  }
}

/**
 * W2 (R11): the sender's newest unconsumed, unexpired chat link, so a repeat
 * BOOK can reuse it instead of minting another live link.
 */
export async function findLiveChatToken(restaurantId: string, phone: string, now: Date = new Date()): Promise<string | null> {
  try {
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase
      .from('booking_tokens')
      .select('token')
      .eq('restaurant_id', restaurantId)
      .eq('phone', phone)
      .eq('source', 'chat')
      .is('consumed_at', null)
      .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    return (data as { token: string }).token
  } catch {
    return null
  }
}

export const bookingTokenStore: BookingTokenStore = {
  peek: peekBookingToken,
  claim: claimBookingToken,
  release: releaseBookingToken,
}
