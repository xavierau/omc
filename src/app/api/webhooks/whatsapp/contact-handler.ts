import crypto from 'crypto'
import { sendCtaUrlButton, sendInteractiveFlow } from '@/infrastructure/whatsapp/messaging'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import {
  getRestaurantRedirect,
  getContactConfig,
  getContactFlowId,
  getRestaurantSlug,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { createContactFormToken } from '@/infrastructure/supabase/repositories/contact-form-token-repository'
import { Language } from '@/domain/value-objects/language'
import { buildContactUrl } from '@/domain/services/contact-redirect'
import { buildContactFormUrl } from '@/domain/services/contact-web-form'
import type { ContactLabels } from '@/domain/services/contact-config'
import { resolveLanguageForMember } from './resolve-language'
import { handleHelp } from './unknown-help-handlers'

const CONTACT_BODY_EN = 'Tap below to chat with us directly.'
const CONTACT_BODY_ZH = '點擊下方按鈕即可直接與我們聯絡。'

const FORM_BODY_ZH = '請填寫以下表格,我們會盡快回覆您。'
const FORM_CTA_ZH = '填寫表格'
const FORM_SCREEN = 'CONTACT_FORM'
const FORM_LINK_FOOTER_ZH = '此連結 30 分鐘內有效'

// The Flow JSON's `data.phone` prefill key (see the wire-casing comment on
// `sendContactFlow` below). Exported so the Flow JSON <-> prefill contract
// test (`contact-form-flow.contract.test.ts`) asserts against this constant
// rather than a re-typed literal.
export const FLOW_PREFILL_PHONE_KEY = 'phone'

// REPLY-007 AD-6: the Flow JSON's per-tenant label bindings (`${data.<key>}`
// on screen `title`, both TextInput `label`s, the Dropdown `label`, and the
// Footer `label`). Values are deliberately lowercase single tokens, NOT
// camelCase like the object keys naming them — the SDK deep-snake_cases
// every outbound message body (including this data's payload) while leaving
// Flow JSON keys verbatim, so e.g. `nameLabel` would ship on the wire as
// `name_label` and silently break the binding to the deployed Flow's
// `namelabel` schema key (see the two-converter comment in
// `scripts/deploy-contact-flow.ts`). Single source of truth for both the
// send payload (contact-handler.ts) and the contract test
// (`contact-form-flow.contract.test.ts`).
export const FLOW_LABEL_DATA_KEYS = {
  title: 'title',
  nameLabel: 'namelabel',
  phoneLabel: 'phonelabel',
  topicLabel: 'topiclabel',
  submitLabel: 'submitlabel',
} as const

/**
 * Handle a CONTACT command (typed keyword or tapped Contact row).
 *
 * Mode branch (REPLY-005, AD-9): a tenant configured for `form` mode with a
 * resolvable Flow id and a notification email gets the WhatsApp Flow. Any
 * precondition unmet, or the flow send itself failing, falls through to the
 * existing redirect logic verbatim — which itself falls back to `handleHelp`.
 * A tenant can therefore never end up with a dead "Contact us": worst case is
 * exactly today's (redirect) behaviour.
 *
 * REPLY-008 inserts a rung between the Flow and the redirect:
 *
 *   Flow  ->  web form  ->  wa.me redirect  ->  help
 *
 * The web form is an ordinary https link, so it needs no Meta approval — which
 * matters because Flow publishing is currently blocked account-side for every
 * tenant (issue #78: business verification incomplete + payment method error →
 * "Integrity requirements not met"). Without this rung a `form`-mode tenant
 * silently degrades to a wa.me chat button that captures no name, no topic,
 * and sends no notification email — i.e. the entire value of the contact form
 * is lost exactly when it is most needed.
 *
 * Deliberately a fallback rather than a fourth `ContactMode`: nothing needs
 * configuring now, and the day Meta approves the tenant the Flow rung starts
 * winning again on its own, with no settings change and no migration back.
 */
export async function handleContact(
  phoneNumberId: string,
  phone: string,
  restaurantId: string
) {
  const config = await getContactConfig(restaurantId)
  if (config.mode === 'form' && config.notificationEmail) {
    const flowId = await getContactFlowId(restaurantId)
    if (flowId) {
      const result = await sendContactFlow(
        phoneNumberId,
        phone,
        restaurantId,
        flowId,
        config.topics,
        config.labels
      )
      if (result.ok) return result
    }

    const webForm = await sendContactWebForm(phoneNumberId, phone, restaurantId, config.labels)
    if (webForm?.ok) return webForm
  }

  return handleContactRedirect(phoneNumberId, phone, restaurantId)
}

/**
 * Issue a one-off web-form link. Returns `null` (not a failed SendResult) when
 * the tenant simply isn't set up for it, so the caller's `?.ok` check treats
 * "can't" and "tried and failed" alike — both fall to the redirect rung.
 *
 * The link's CTA label reuses the tenant's own `submitLabel`-adjacent copy
 * (`labels.title`) so the button reads the same as the Flow it stands in for.
 */
async function sendContactWebForm(
  phoneNumberId: string,
  phone: string,
  restaurantId: string,
  labels: ContactLabels
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) return null

  const slug = await getRestaurantSlug(restaurantId)
  if (!slug) return null

  const token = await createContactFormToken(restaurantId, phone)
  if (!token) return null

  const url = buildContactFormUrl(appUrl, slug, token)
  if (!url) return null

  // Footer states the expiry up front: the link dies in 30 minutes (see
  // CONTACT_FORM_TOKEN_TTL_MS), and a customer who knows that is far more
  // likely to finish now than to discover it later on the recovery page.
  return sendCtaUrlButton(phoneNumberId, phone, FORM_BODY_ZH, labels.title, url, FORM_LINK_FOOTER_ZH)
}

function sendContactFlow(
  phoneNumberId: string,
  phone: string,
  restaurantId: string,
  flowId: string,
  topics: string[],
  labels: ContactLabels
) {
  const flowToken = `cf.v1.${restaurantId}.${crypto.randomUUID()}`
  return sendInteractiveFlow(phoneNumberId, phone, FORM_BODY_ZH, {
    flowId,
    flowCta: FORM_CTA_ZH,
    flowToken,
    screen: FORM_SCREEN,
    data: {
      topics: topics.map((topic) => ({ id: topic, title: topic })),
      // Must stay a single lowercase token: the SDK deep-converts outbound
      // message bodies via toSnakeCaseDeep (so e.g. `waNumber` becomes
      // `wa_number`, and `phoneNumber` is explicitly remapped to
      // `phone_number`), while the Flow JSON asset's data fields are left
      // verbatim by a different converter (toFlowJsonWireCase). `phone`
      // survives both unchanged, so the deployed Flow and this payload agree
      // on the key. Renaming this requires renaming the Flow JSON in lockstep.
      //
      // Value format (code review M3): `phone` here is always
      // `PhoneNumber.create(message.from).value` upstream (handlers.ts),
      // i.e. E.164 WITH the leading `+` (e.g. `+85291234567`) — the same
      // format the repo already stores `restaurants.whatsapp_number` in.
      // Meta's acceptance of a `+`-prefixed `init-value` on an
      // `inputType: "phone"` TextInput is verified at deploy/live-test time
      // (not offline, per the Flow JSON's own `__example__`).
      [FLOW_PREFILL_PHONE_KEY]: phone,
      // REPLY-007 AD-6/AD-7: all five label keys are always sent — the Flow
      // binds them dynamically (`${data.<key>}`), so a missing key breaks
      // rendering. `resolveContactConfig` guarantees `labels` is a complete
      // set of concrete strings (defaults on anything unresolved), so there
      // is nothing to defend against here beyond sending them.
      [FLOW_LABEL_DATA_KEYS.title]: labels.title,
      [FLOW_LABEL_DATA_KEYS.nameLabel]: labels.nameLabel,
      [FLOW_LABEL_DATA_KEYS.phoneLabel]: labels.phoneLabel,
      [FLOW_LABEL_DATA_KEYS.topicLabel]: labels.topicLabel,
      [FLOW_LABEL_DATA_KEYS.submitLabel]: labels.submitLabel,
    },
  })
}

async function handleContactRedirect(
  phoneNumberId: string,
  phone: string,
  restaurantId: string
) {
  const { redirectNumber, redirectLabel } = await getRestaurantRedirect(restaurantId)
  const url = redirectNumber ? buildContactUrl(redirectNumber) : null
  if (!url) {
    return handleHelp(phoneNumberId, phone, restaurantId)
  }

  const member = await findMemberByPhone(restaurantId, phone)
  const language = await resolveLanguageForMember(member, restaurantId)
  const body = language.equals(Language.EN) ? CONTACT_BODY_EN : CONTACT_BODY_ZH
  return sendCtaUrlButton(phoneNumberId, phone, body, redirectLabel, url)
}
