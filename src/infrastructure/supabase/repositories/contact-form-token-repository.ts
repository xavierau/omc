/**
 * REPLY-008: persistence for the web contact form's one-off tokens.
 *
 * See `supabase/migrations/060_contact_form_tokens.sql` for why the token is
 * a stored capability rather than a signed payload.
 */
import { randomBytes } from 'crypto'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { CONTACT_FORM_TOKEN_TTL_MS, type ContactTokenState } from '@/domain/services/contact-web-form'

/** 256 bits, URL-safe — unguessable, and safe to hand to WhatsApp as a CTA URL. */
function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

export interface ContactTokenOwner {
  restaurantId: string
  phone: string
}

/**
 * Mint a token for a tenant + sender. Returns `null` on any failure: this runs
 * inside the webhook's contact ladder, where a failed mint must degrade to the
 * next rung (the wa.me redirect) rather than throw.
 */
export async function createContactFormToken(
  restaurantId: string,
  phone: string,
  now: Date = new Date()
): Promise<string | null> {
  try {
    const supabase = createServerSupabaseClient()
    const token = generateToken()
    const { error } = await supabase.from('contact_form_tokens').insert({
      token,
      restaurant_id: restaurantId,
      phone,
      expires_at: new Date(now.getTime() + CONTACT_FORM_TOKEN_TTL_MS).toISOString(),
    })
    if (error) {
      console.warn('[ContactForm] token mint failed:', error.message)
      return null
    }
    return token
  } catch (err) {
    console.warn('[ContactForm] token mint threw:', (err as Error).message)
    return null
  }
}

/**
 * Read a token's state WITHOUT consuming it — for rendering the page.
 *
 * Deliberately non-consuming: a page load is not a submission, and burning the
 * token here would break the ordinary case where a customer opens the form,
 * reads it, and then submits. Fails closed to 'unknown' so a transient DB
 * error shows the recovery path rather than a form that cannot submit.
 */
export async function peekContactFormToken(
  token: string,
  now: Date = new Date()
): Promise<{ state: ContactTokenState; owner: ContactTokenOwner | null }> {
  try {
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase
      .from('contact_form_tokens')
      .select('restaurant_id, phone, expires_at, consumed_at')
      .eq('token', token)
      .maybeSingle()

    if (error || !data) return { state: 'unknown', owner: null }

    const row = data as {
      restaurant_id: string
      phone: string
      expires_at: string
      consumed_at: string | null
    }
    const owner = { restaurantId: row.restaurant_id, phone: row.phone }

    // Consumed is checked before expiry: "you already submitted this" is a
    // more useful thing to tell someone than "this expired", and a consumed
    // token inevitably expires later too.
    if (row.consumed_at) return { state: 'consumed', owner }
    if (new Date(row.expires_at).getTime() <= now.getTime()) {
      return { state: 'expired', owner }
    }
    return { state: 'valid', owner }
  } catch (err) {
    console.warn('[ContactForm] token peek threw:', (err as Error).message)
    return { state: 'unknown', owner: null }
  }
}

/**
 * Atomically claim a token, returning its owner only to the caller that won.
 *
 * This — not the client's modal dismissal — is what makes a link single-use.
 * The customer can close the tab, lose signal, or have the WebView killed
 * before any dismissal handler runs; by the time the success modal renders the
 * token must already be dead. The conditional UPDATE (`consumed_at IS NULL`
 * AND not expired) also settles the double-submit race in the database, so two
 * rapid POSTs yield one accepted submission and one "already submitted".
 *
 * Expiry is re-checked HERE, not just at page load: a form opened at minute 29
 * and submitted at minute 45 must fail, or the 30-minute TTL would only be a
 * suggestion.
 */
export async function consumeContactFormToken(
  token: string,
  now: Date = new Date()
): Promise<ContactTokenOwner | null> {
  try {
    const supabase = createServerSupabaseClient()
    const nowIso = now.toISOString()
    const { data, error } = await supabase
      .from('contact_form_tokens')
      .update({ consumed_at: nowIso })
      .eq('token', token)
      .is('consumed_at', null)
      .gt('expires_at', nowIso)
      .select('restaurant_id, phone')
      .maybeSingle()

    if (error || !data) return null
    const row = data as { restaurant_id: string; phone: string }
    return { restaurantId: row.restaurant_id, phone: row.phone }
  } catch (err) {
    console.warn('[ContactForm] token consume threw:', (err as Error).message)
    return null
  }
}
