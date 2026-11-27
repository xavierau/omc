/**
 * BOOK-014 (threat R62): the neutral pages of /p/<token>, zh-HK first then
 * English. They name no restaurant, date, party or amount: a link that
 * reaches the wrong person reveals nothing. Plain HTML (no app shell, no
 * scripts), served with the booking security headers.
 */
import type { PaymentLinkState } from '@/application/payments/resolve-payment-link'

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
        zh: { title: '訂座保留已過期', body: '此訂座保留已過期。如已付款，款項將會全數退回。請在 WhatsApp 聯絡餐廳取得新連結。' },
        en: { title: 'This hold has lapsed', body: 'This booking hold has lapsed. Any payment made will be refunded in full. Message us on WhatsApp for a new link.' },
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
        zh: { title: '尚未完成付款', body: `你可在 ${until} 前完成付款。` },
        en: { title: 'Payment not finished', body: `You have until ${until} to pay.` },
      }
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

export function renderPaymentLinkPage(state: PageState, token: string): { status: number; html: string } {
  const copy = copyFor(state)
  const payNow =
    state.kind === 'unfinished'
      ? `<p><a class="btn" data-testid="booking-pay-pending" href="/p/${encodeURIComponent(token)}">立即付款 · Pay now</a></p>`
      : ''
  const testId = state.kind === 'lapsed' ? ' data-testid="booking-pay-lapsed"' : ''
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
.btn{display:inline-block;padding:.75rem 1.25rem;border-radius:.5rem;background:#1f1d1a;color:#fff;text-decoration:none}
</style>
</head>
<body>
<main${testId}>
<section lang="zh-HK"><h1>${escape(copy.zh.title)}</h1><p>${escape(copy.zh.body)}</p></section>
<section lang="en"><h1>${escape(copy.en.title)}</h1><p>${escape(copy.en.body)}</p></section>
${payNow}
</main>
</body>
</html>`
  return { status: copy.status, html }
}
