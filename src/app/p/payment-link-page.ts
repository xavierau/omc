/**
 * BOOK-014 (threat R62): the pages of /p/<token>, zh-HK first then English.
 * Plain HTML (no app shell, no scripts), served with the booking security
 * headers. Unknown, lapsed and unavailable links are neutral: they name no
 * restaurant, date, party or amount.
 * W3 (spec AC-5..AC-7): a live link's paid / confirming / not-finished page
 * shows the restaurant, date, time, party and amount when the resolver gave
 * them; never the diner's name, phone or notes.
 * W3 r2: refunded (being / has been refunded) and closed (kept, neutral).
 * W6a: held (paid, booking cancelled or no-show, the restaurant decides).
 */
import type { PaymentLinkDetails, PaymentLinkState } from '@/application/payments/resolve-payment-link'
import { formatMoney } from '@/domain/value-objects/money'

type PageState = Exclude<PaymentLinkState, { kind: 'redirect' }>

interface Copy {
  status: number
  zh: { title: string; body: string }
  en: { title: string; body: string }
}

const hkTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))

function copyFor(state: PageState): Copy {
  switch (state.kind) {
    case 'not_found':
      return {
        status: 404,
        zh: { title: '連結無效', body: '此付款連結無效。如需協助，請在 WhatsApp 聯絡餐廳。' },
        en: { title: 'Link not valid', body: 'This payment link is not valid. Message the restaurant on WhatsApp for help.' },
      }
    case 'lapsed':
      return {
        status: 410,
        zh: { title: '訂座保留已過期', body: '此訂座保留已過期，請在 WhatsApp 聯絡我們取得新連結。如已付款，款項將會全數退回。' },
        en: { title: 'This hold has lapsed', body: 'This hold has lapsed, message us on WhatsApp for a new link. Any payment made will be refunded in full.' },
      }
    case 'paid':
      return {
        status: 200,
        zh: { title: '已收到訂金', body: '訂金已付，訂座要求已送出。餐廳會在 WhatsApp 通知你。' },
        en: { title: 'Deposit paid', body: 'Deposit paid, request sent. The restaurant will reply on WhatsApp.' },
      }
    case 'processing':
      return {
        status: 200,
        zh: { title: '正在確認付款', body: '多謝！我們正在確認你的付款，確認後會在 WhatsApp 通知你。' },
        en: { title: 'Confirming your payment', body: 'Thank you. We are confirming your payment and will message you on WhatsApp.' },
      }
    case 'unfinished': {
      const until = hkTime(state.holdExpiresAt)
      return {
        status: 200,
        zh: { title: '尚未完成付款', body: `付款尚未完成，你可在 ${until} 前完成付款。` },
        en: { title: 'Payment not finished', body: `Payment not finished. You have until ${until} to pay.` },
      }
    }
    case 'refunded':
      return {
        status: 200,
        zh: { title: '訂金退款', body: '你的訂金正在退款或已經退回。如有疑問，請在 WhatsApp 聯絡我們。' },
        en: { title: 'Deposit refunded', body: 'Your deposit is being refunded or has been refunded. Message us on WhatsApp if you have questions.' },
      }
    case 'held':
      return {
        status: 200,
        zh: { title: '訂金暫由餐廳保留', body: '你的訂金暫由餐廳保留，餐廳會決定如何處理。如有疑問，請在 WhatsApp 聯絡我們。' },
        en: { title: 'Deposit held', body: 'Your deposit is held; the restaurant will decide on it. Message us on WhatsApp if you have questions.' },
      }
    case 'closed':
      return {
        status: 410,
        zh: { title: '此訂座已結束', body: '此訂座已結束，請在 WhatsApp 聯絡我們。' },
        en: { title: 'This booking is closed', body: 'This booking is closed, message us on WhatsApp.' },
      }
    case 'unavailable':
      return {
        status: 503,
        zh: { title: '暫時未能付款', body: '付款服務暫時未能使用，請在 WhatsApp 聯絡餐廳。' },
        en: { title: 'Payment is unavailable', body: 'Payment is unavailable right now, please message us on WhatsApp.' },
      }
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const TEST_IDS: Partial<Record<PageState['kind'], string>> = {
  paid: 'booking-pay-paid',
  refunded: 'booking-pay-refunded',
  closed: 'booking-pay-closed',
  held: 'booking-pay-held',
  unfinished: 'booking-pay-pending',
  lapsed: 'booking-pay-lapsed',
}

/** W3: one line per language; every value escaped. */
function detailLines(details: PaymentLinkDetails | undefined): { zh: string; en: string } {
  if (!details) return { zh: '', en: '' }
  const name = details.restaurantName ? `${escape(details.restaurantName)} · ` : ''
  const when = `${escape(details.bookingDate)} ${escape(details.bookingTime)}`
  const amount = escape(formatMoney(details.amount))
  const n = details.partySize
  return {
    zh: `<p class="details" data-testid="booking-pay-details">${name}${when} · ${n} 位 · 訂金 ${amount}</p>`,
    en: `<p class="details">${name}${when} · ${n} ${n === 1 ? 'guest' : 'guests'} · Deposit ${amount}</p>`,
  }
}

export function renderPaymentLinkPage(state: PageState, token: string): { status: number; html: string } {
  const copy = copyFor(state)
  const payNow =
    state.kind === 'unfinished'
      ? `<p><a class="btn" data-testid="booking-pay-now" href="/p/${encodeURIComponent(token)}">立即付款 · Pay now</a></p>`
      : ''
  const id = TEST_IDS[state.kind]
  const testId = id ? ` data-testid="${id}"` : ''
  const lines = detailLines('details' in state ? state.details : undefined)
  const html = `<!doctype html>
<html lang="zh-HK">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escape(copy.zh.title)} · ${escape(copy.en.title)}</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,"PingFang HK","Noto Sans HK",sans-serif;background:#faf8f5;color:#1f1d1a}
main{max-width:28rem;margin:0 auto;padding:3rem 1rem}
h1{font-size:1.25rem;margin:0 0 .5rem}
p{line-height:1.5;margin:0 0 1rem}
section+section{margin-top:2rem;padding-top:1.5rem;border-top:1px solid #e7e2da}
.details{font-weight:600}
.btn{display:inline-block;padding:.75rem 1.25rem;border-radius:.5rem;background:#1f1d1a;color:#fff;text-decoration:none}
</style>
</head>
<body>
<main${testId}>
<section lang="zh-HK"><h1>${escape(copy.zh.title)}</h1>${lines.zh}<p>${escape(copy.zh.body)}</p></section>
<section lang="en"><h1>${escape(copy.en.title)}</h1>${lines.en}<p>${escape(copy.en.body)}</p></section>
${payNow}
</main>
</body>
</html>`
  return { status: copy.status, html }
}
