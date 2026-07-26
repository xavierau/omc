import crypto from 'crypto'
import { sendCtaUrlButton, sendInteractiveFlow } from '@/infrastructure/whatsapp/messaging'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import {
  getRestaurantRedirect,
  getContactConfig,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { Language } from '@/domain/value-objects/language'
import { buildContactUrl } from '@/domain/services/contact-redirect'
import { resolveContactFlowId } from '@/infrastructure/whatsapp/flows/contact-flow-id'
import { resolveLanguageForMember } from './resolve-language'
import { handleHelp } from './unknown-help-handlers'

const CONTACT_BODY_EN = 'Tap below to chat with us directly.'
const CONTACT_BODY_ZH = '點擊下方按鈕即可直接與我們聯絡。'

const FORM_BODY_ZH = '請填寫以下表格,我們會盡快回覆您。'
const FORM_CTA_ZH = '填寫表格'
const FORM_SCREEN = 'CONTACT_FORM'

// The Flow JSON's `data.phone` prefill key (see the wire-casing comment on
// `sendContactFlow` below). Exported so the Flow JSON <-> prefill contract
// test (`contact-form-flow.contract.test.ts`) asserts against this constant
// rather than a re-typed literal.
export const FLOW_PREFILL_PHONE_KEY = 'phone'

/**
 * Handle a CONTACT command (typed keyword or tapped Contact row).
 *
 * Mode branch (REPLY-005, AD-9): a tenant configured for `form` mode with a
 * resolvable Flow id and a notification email gets the WhatsApp Flow. Any
 * precondition unmet, or the flow send itself failing, falls through to the
 * existing redirect logic verbatim — which itself falls back to `handleHelp`.
 * A tenant can therefore never end up with a dead "Contact us": worst case is
 * exactly today's (redirect) behaviour.
 */
export async function handleContact(
  phoneNumberId: string,
  phone: string,
  restaurantId: string
) {
  const config = await getContactConfig(restaurantId)
  if (config.mode === 'form' && config.notificationEmail) {
    const flowId = resolveContactFlowId()
    if (flowId) {
      const result = await sendContactFlow(phoneNumberId, phone, restaurantId, flowId, config.topics)
      if (result.ok) return result
    }
  }

  return handleContactRedirect(phoneNumberId, phone, restaurantId)
}

function sendContactFlow(
  phoneNumberId: string,
  phone: string,
  restaurantId: string,
  flowId: string,
  topics: string[]
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
