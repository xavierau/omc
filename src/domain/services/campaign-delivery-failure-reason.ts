// Tenant-visible reason for a campaign whose every counted send was rejected
// by Meta AFTER the synchronous ack (#131). Fixed wording only — never raw
// send-error internals — and every variant names the deciding system
// (WhatsApp / Meta) and disclaims the look-alike system (OhMyClient's own
// template review, WAQ-014), so a tenant is not sent to the wrong desk.

const NOT_OHMYCLIENT =
  'This is not an OhMyClient review or template issue.'

export function deliveryFailureReason(
  errorCode: string | null,
  errorTitle: string | null
): string {
  if (errorCode === '131042') {
    return (
      'WhatsApp (Meta) rejected every message in this campaign: the WhatsApp ' +
      'Business account has no billing currency configured (Meta error 131042). ' +
      'Set the currency in Meta Business Manager → Billing & payments, then ' +
      `re-run the campaign. ${NOT_OHMYCLIENT}`
    )
  }
  if (errorCode === '131047') {
    return (
      'WhatsApp (Meta) rejected every message in this campaign: the recipients ' +
      'had no open 24-hour customer service window (Meta error 131047). ' +
      'Free-form messages only reach customers who replied within the last ' +
      '24 hours — use an approved template with a quick-reply (claim) button ' +
      `instead, then re-run the campaign. ${NOT_OHMYCLIENT}`
    )
  }
  return (
    'WhatsApp (Meta) reported every message in this campaign as failed after ' +
    `it was sent${describeError(errorCode, errorTitle)}. Check the number's ` +
    `health in Meta Business Manager before re-running. ${NOT_OHMYCLIENT}`
  )
}

function describeError(code: string | null, title: string | null): string {
  if (!code) return ''
  return title ? ` (Meta error ${code}: ${title})` : ` (Meta error ${code})`
}
