/**
 * REPLY-008: public web contact form — the fallback rung used while WhatsApp
 * Flows cannot be published (issue #78).
 *
 * Server component: it resolves the tenant, inspects the one-off token, and
 * decides which of the terminal states to render. The token is only PEEKED
 * here — rendering a page is not submitting one, and consuming on load would
 * break the ordinary read-then-submit case. The claim happens in the POST.
 */
import { notFound } from 'next/navigation'
import {
  findBySlug,
  getContactConfig,
  getRestaurantEmailContext,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { peekContactFormToken } from '@/infrastructure/supabase/repositories/contact-form-token-repository'
import { buildContactUrl } from '@/domain/services/contact-redirect'
import { ContactWebForm } from './contact-web-form'
import { ContactFormUnavailable } from './contact-form-unavailable'

// Always dynamic: the page's content depends on live token state, and a cached
// render would show a working form for a token that has since been consumed.
export const dynamic = 'force-dynamic'

export default async function ContactFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ t?: string }>
}) {
  const { slug } = await params
  const { t: token } = await searchParams

  const restaurant = await findBySlug(slug)
  if (!restaurant) notFound()

  // The deep link that re-triggers CONTACT on the tenant's own number, so an
  // unusable link is one tap from a fresh one with no human involved. Uses the
  // tenant's WhatsApp number (not the staff redirect number) because it is the
  // bot that mints links, and prefills a real CONTACT keyword. Read via the
  // email-context getter rather than widening RESTAURANT_COLUMNS, which the
  // repository deliberately keeps off the webhook hot path.
  const { whatsappNumber } = await getRestaurantEmailContext(restaurant.id)
  const retryUrl = whatsappNumber ? buildContactUrl(whatsappNumber, CONTACT_KEYWORD) : null

  // Only the state is needed: nothing on the page renders the token's phone,
  // so the number never reaches the browser.
  const state = token ? (await peekContactFormToken(token)).state : 'unknown'

  if (state !== 'valid' || !token) {
    return (
      <Shell>
        <ContactFormUnavailable
          state={state === 'valid' ? 'unknown' : state}
          tenantName={restaurant.name}
          logoUrl={restaurant.logo_url}
          retryUrl={retryUrl}
        />
      </Shell>
    )
  }

  const config = await getContactConfig(restaurant.id)

  return (
    <Shell>
      <ContactWebForm
        slug={slug}
        token={token}
        tenantName={restaurant.name}
        logoUrl={restaurant.logo_url}
        labels={config.labels}
        topics={config.topics}
        retryUrl={retryUrl}
        returnUrl={whatsappNumber ? buildContactUrl(whatsappNumber) : null}
      />
    </Shell>
  )
}

/**
 * One of `command-keywords.ts`'s CONTACT synonyms, prefilled into the recovery
 * deep link so sending it re-enters `handleContact` and mints a new token.
 */
const CONTACT_KEYWORD = '聯絡我們'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">{children}</main>
  )
}
