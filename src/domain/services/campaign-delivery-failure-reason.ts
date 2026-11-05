// Tenant-visible reason for a campaign whose every counted send was rejected
// by Meta AFTER the synchronous ack (#131). Fixed wording only — never raw
// send-error internals — and every variant names the deciding system
// (WhatsApp / Meta) and disclaims the look-alike system (OhMyClient's own
// template review, WAQ-014), so a tenant is not sent to the wrong desk.
//
// CAMP-014: one error code can cover several causes. 131042 is worded from
// what Meta's detail says, and asserts no cause Meta did not state.

const NOT_OHMYCLIENT =
  'This is not an OhMyClient review or template issue.'

// The 131047 wording and its predicate share this phrase, as delivery-unknown
// does below, so /rerun's refusal cannot drift from what a run stored.
const NO_SERVICE_WINDOW_PHRASE = 'no open 24-hour customer service window'

const REJECTED_131042 = 'WhatsApp (Meta) rejected every message in this campaign:'
const BILLING_PAGE = 'Meta Business Manager → Billing & payments'
// A Meta title is outside text; keep the reason inside FAILURE_REASON_MAX_LEN.
const MAX_TITLE_LEN = 120

export function deliveryFailureReason(
  errorCode: string | null,
  errorTitle: string | null,
  errorDetails: string | null
): string {
  if (errorCode === '131042') return paymentFailureReason(errorDetails)
  if (errorCode === '131047') {
    return (
      'WhatsApp (Meta) rejected every message in this campaign: the recipients ' +
      `had ${NO_SERVICE_WINDOW_PHRASE} (Meta error 131047). ` +
      'Free-form messages only reach customers who replied within the last ' +
      '24 hours. Create a new campaign with an approved template that has a ' +
      "quick-reply (claim) button, because a failed campaign's template cannot " +
      `be changed. ${NOT_OHMYCLIENT}`
    )
  }
  return (
    'WhatsApp (Meta) reported every message in this campaign as failed after ' +
    `it was sent${describeError(errorCode, errorTitle)}. Check the number's ` +
    `health in Meta Business Manager before re-running. ${NOT_OHMYCLIENT}`
  )
}

export function isNoServiceWindowReason(reason: string | null | undefined): boolean {
  return reason?.includes(NO_SERVICE_WINDOW_PHRASE) ?? false
}

function paymentFailureReason(errorDetails: string | null): string {
  const details = errorDetails?.toLowerCase() ?? ''
  if (details.includes('restricted')) {
    return (
      `${REJECTED_131042} Meta has restricted payments on the WhatsApp Business ` +
      `account (Meta error 131042). Clear the restriction in ${BILLING_PAGE}, ` +
      `then re-run the campaign. ${NOT_OHMYCLIENT}`
    )
  }
  if (details.includes('currency')) {
    return (
      `${REJECTED_131042} the WhatsApp Business account has no billing currency ` +
      `configured (Meta error 131042). Set the currency in ${BILLING_PAGE}, ` +
      `then re-run the campaign. ${NOT_OHMYCLIENT}`
    )
  }
  if (details.includes('payment method')) {
    return (
      `${REJECTED_131042} Meta reported a problem with the payment method on the ` +
      `WhatsApp Business account (Meta error 131042). Fix the payment method in ` +
      `${BILLING_PAGE}, then re-run the campaign. ${NOT_OHMYCLIENT}`
    )
  }
  return (
    `${REJECTED_131042} there is a payment problem on the WhatsApp Business account ` +
    `(Meta error 131042). Check ${BILLING_PAGE}, then re-run the campaign. ${NOT_OHMYCLIENT}`
  )
}

function describeError(code: string | null, title: string | null): string {
  if (!code) return ''
  return title
    ? ` (Meta error ${code}: ${title.slice(0, MAX_TITLE_LEN)})`
    : ` (Meta error ${code})`
}

// A run with an `errored` member: the send may have gone out before bookkeeping
// broke, so a re-run can double-send. The wording and the predicate share this
// phrase so /rerun's refusal cannot drift from what a run actually stored.
const DELIVERY_UNKNOWN_PHRASE = 'delivery could not be confirmed'

export function deliveryUnknownReason(broken: number, errored: number): string {
  return (
    `${broken} message sends did not complete and ${DELIVERY_UNKNOWN_PHRASE} ` +
    `for ${errored} of them. Contact support before re-running this campaign.`
  )
}

export function isDeliveryUnknownReason(reason: string | null | undefined): boolean {
  return reason?.includes(DELIVERY_UNKNOWN_PHRASE) ?? false
}
