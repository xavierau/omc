import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
// BOOK-014 W4 AC-3 local walk driver (fake data only), helpers from BOOK-013's walk.mjs. Headless Chromium over
// CDP; screenshots + the ui-layout-audit script per screen; writes walk-steps-<tag>.json.
//   node walk.mjs <locale> <width> <password-file>   (dev server on 3110 with NEXT_PUBLIC_DEFAULT_LOCALE=<locale>)
// Plain viewports: 1200x900 DPR 1 and 390x844 DPR 2.
import path from 'node:path'
import os from 'node:os'


const [locale, widthArg, passwordFile] = process.argv.slice(2)
const password = fs.readFileSync(passwordFile, 'utf8').trim()
const W = Number(widthArg)
const phone = W < 600
const H = phone ? 844 : 900
const OUT = path.dirname(new URL(import.meta.url).pathname)
const BASE = 'http://localhost:3110'
const RID = '11111111-1111-4111-8111-111111111111'
const CHROME = `${os.homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const AUDIT = fs.readFileSync(`${os.homedir()}/.claude/skills/ui-layout-audit/layout-audit.js`, 'utf8')
const PORT = 9400 + (W % 97) + (locale === 'en' ? 1 : 0)
const tag = `${locale === 'en' ? 'en' : 'zh'}-${W}`
const EN = locale === 'en'
const steps = []
const FAIL_FLAG = path.join(OUT, '.fail-refunds')

const sql = (q) => execFileSync('psql', ['-X', '-h', '127.0.0.1', '-p', '55622', '-U', 'postgres', '-d', 'postgres', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const idOf = (name) => sql(`select id from booking_requests where restaurant_id='${RID}' and name='${name}' order by created_at desc limit 1`)
const depOf = (name) => sql(`select d.status || '|' || coalesce(d.refund_reason,'-') || '|' || d.refund_attempts from booking_deposits d join booking_requests b on b.id=d.booking_id where b.restaurant_id='${RID}' and b.name='${name}'`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const stripeLog = path.join(OUT, 'stripe-fake.jsonl')
const stripeLines = () => (fs.existsSync(stripeLog) ? fs.readFileSync(stripeLog, 'utf8').split('\n').filter(Boolean).length : 0)

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b14w4-'))
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
let target
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200)
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
}
const browserWs = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map()
const consoleErrors = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description?.slice(0, 300) ?? m.params.exceptionDetails.text)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300))
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push(`log: ${m.params.entry.text.slice(0, 200)} ${m.params.entry.url ?? ''}`)
})
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res.result?.exceptionDetails) throw new Error(`${expression.slice(0, 80)}: ${res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text}`)
  return res.result?.result?.value
}
// Clipboard for Copy link (headless denies it by default).
{
  const bws = new WebSocket(browserWs)
  await new Promise((r) => bws.addEventListener('open', r, { once: true }))
  await new Promise((r) => { bws.addEventListener('message', r, { once: true }); bws.send(JSON.stringify({ id: 1, method: 'Browser.grantPermissions', params: { origin: BASE, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] } })) })
  bws.close()
}
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__copied = []; if (navigator.clipboard) navigator.clipboard.writeText = (t) => { window.__copied.push(t); return Promise.resolve() }" })
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: phone ? 2 : 1, mobile: false })

const q = (sel) => `([...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getClientRects().length > 0) ?? null)`
const exists = (sel) => evaluate(`!!${q(sel)}`)
async function waitFor(sel, ms = 20000) {
  for (let t = 0; t < ms; t += 200) { if (await exists(sel)) return; await sleep(200) }
  throw new Error(`timeout waiting for ${sel}`)
}
async function waitUntil(expr, ms = 15000) {
  for (let t = 0; t < ms; t += 200) { if (await evaluate(expr)) return true; await sleep(200) }
  return false
}
async function goto(url, sel) {
  await send('Page.navigate', { url: BASE + url }); await sleep(800)
  if (sel) await waitFor(sel, 90000)
  await sleep(800)
}
async function click(sel) {
  await waitFor(sel)
  if (await evaluate(`${q(sel)}.getAttribute('role') === 'menuitem'`)) {
    await evaluate(`${q(sel)}.focus()`)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await sleep(600)
    return
  }
  const r = await evaluate(`(() => { const e = ${q(sel)}; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`)
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1, pointerType: 'mouse' })
  await sleep(600)
}
async function type(sel, text) {
  await click(sel)
  await evaluate(`(() => { const e = ${q(sel)}; e.select?.(); })()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  if (text) await send('Input.insertText', { text })
  await sleep(500)
}
async function setValue(sel, value) {
  await evaluate(`(() => { const e = ${q(sel)}; const proto = e instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(900)
}
const text = (sel) => evaluate(`(${q(sel)}?.innerText ?? '').trim()`)
const attr = (sel, a) => evaluate(`${q(sel)}?.getAttribute(${JSON.stringify(a)}) ?? null`)
const url = () => evaluate('location.pathname + location.search')
async function shot(name, note) {
  await sleep(600)
  const audit = await evaluate(AUDIT).catch((e) => ({ error: String(e) }))
  await evaluate('window.scrollTo(0,0)').catch(() => {})
  const file = `${name}-${tag}.jpeg`
  const img = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: true, clip: await evaluate(`({ x: 0, y: 0, width: ${W}, height: Math.min(document.documentElement.scrollHeight, 4000), scale: 1 })`) })
  fs.writeFileSync(path.join(OUT, file), Buffer.from(img.result.data, 'base64'))
  const blocking = (audit?.findings ?? []).filter((f) => f.sev === 'blocking')
  const warnings = (audit?.findings ?? []).filter((f) => f.sev === 'warning').map((f) => `${f.check}: ${String(f.el).slice(0, 90)} | ${String(f.detail).slice(0, 120)}`)
  steps.push({ step: name, note, file, url: await url(), audit: audit?.summary ?? audit, viewport: audit?.viewport, blocking, warnings })
  console.log(`${file}  blocking=${audit?.summary?.blocking ?? '?'} warning=${audit?.summary?.warning ?? '?'}`)
}
async function focusShot(name, sel, note) {
  await evaluate(`${q(sel)}.scrollIntoView({ block: 'center' })`)
  await sleep(500)
  const file = `${name}-${tag}.jpeg`
  const img = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 })
  fs.writeFileSync(path.join(OUT, file), Buffer.from(img.result.data, 'base64'))
  steps.push({ step: name, note, file, focus: sel })
}
const check = (name, ok, detail) => { steps.push({ check: name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail ?? ''}`) }
const badge = (id) => attr(`[data-testid=booking-deposit-badge-${id}]`, 'data-state')
const toastKind = () => attr('[data-testid=booking-toast]', 'data-kind')

const todayHK = sql(`select (now() at time zone 'Asia/Hong_Kong')::date`)
const yesterdayHK = sql(`select (now() at time zone 'Asia/Hong_Kong')::date - 1`)
const ids = Object.fromEntries(['Wong Awaiting', 'Lee Paid', 'Ho Paid', 'Cheung Paid', 'Ng No-show', 'Tam Kept', 'Yip Refunded', 'Kwok Pending', 'Lau Failed', 'Diner Hold', 'Diner Lapsed', 'Chan No Deposit', 'Fong Past'].map((n) => [n, idOf(n)]))
const calendarDay = async (date) => {
  await goto('/dashboard/bookings?view=calendar', `[data-testid=bookings-calendar-day-${date}]`)
  if (date < todayHK && !(await exists(`[data-testid=bookings-calendar-day-${date}]`))) await click('[data-testid=bookings-calendar-prev]')
  await click(`[data-testid=bookings-calendar-day-${date}]`)
  await waitFor('[data-testid=bookings-day-panel]')
  await sleep(800)
}
const rowIn = (id, sel) => `[data-testid=bookings-day-panel] [data-testid=${sel.replace('<id>', id)}]`

try {
  fs.rmSync(FAIL_FLAG, { force: true })
  await goto('/login', 'input[type=email]')
  await type('input[type=email]', 'walk-staff@example.test')
  await type('input[type=password]', password)
  await click('button[type=submit]')
  await sleep(3500)

  // 1. Today: the deposit on every row that has one; diner holds / lapsed hidden.
  await goto('/dashboard/bookings?view=today', '[data-testid=bookings-today-list]')
  await sleep(1000)
  const todayIds = await evaluate(`[...document.querySelectorAll('[data-testid^="booking-row-"]')].map((e) => e.dataset.testid).filter((t) => /^booking-row-[0-9a-f-]{36}$/.test(t)).map((t) => t.slice(12))`)
  const todayNames = Object.entries(ids).filter(([, id]) => todayIds.includes(id)).map(([n]) => n)
  check('today: staff hold shown, diner hold + lapsed hidden', todayNames.includes('Wong Awaiting') && !todayNames.includes('Diner Hold') && !todayNames.includes('Diner Lapsed'), todayNames.join(', '))
  check('today: badges awaiting / paid / no-show paid', (await badge(ids['Wong Awaiting'])) === 'awaiting' && (await badge(ids['Cheung Paid'])) === 'paid' && (await badge(ids['Ng No-show'])) === 'paid', `${await badge(ids['Wong Awaiting'])} ${await badge(ids['Cheung Paid'])} ${await badge(ids['Ng No-show'])}`)
  check('today: no badge without a deposit', !(await exists(`[data-testid=booking-deposit-badge-${ids['Chan No Deposit']}]`)))
  check('today: no-show paid offers Refund + Keep', (await exists(`[data-testid=booking-row-${ids['Ng No-show']}-refund]`)) && (await exists(`[data-testid=booking-row-${ids['Ng No-show']}-keep]`)))
  check('today: staff hold offers Copy link', await exists(`[data-testid=booking-row-${ids['Wong Awaiting']}-deposit-copy-link]`))
  await shot('01-today', 'Today: awaiting (staff), paid, no-show with Deposit held + Refund/Keep')

  // 2. Table: every state.
  await goto('/dashboard/bookings?view=table', '[data-testid=bookings-table]')
  await sleep(1200)
  const states = {}
  for (const n of ['Wong Awaiting', 'Lee Paid', 'Tam Kept', 'Yip Refunded', 'Kwok Pending', 'Lau Failed']) states[n] = await badge(ids[n])
  check('table: awaiting, paid, kept, refunded, refund pending, refund failed', JSON.stringify(Object.values(states)) === JSON.stringify(['awaiting', 'paid', 'kept', 'refunded', 'refund_pending', 'refund_failed']), JSON.stringify(states))
  check('table: refund failed offers Retry', await exists(`[data-testid=booking-row-${ids['Lau Failed']}-refund-retry]`))
  check('table: diner hold and lapsed not listed', !(await exists(`[data-testid=booking-row-${ids['Diner Hold']}]`)) && !(await exists(`[data-testid=booking-row-${ids['Diner Lapsed']}]`)))
  await shot('02-table', 'Table: one deposit state per row')

  // 3. Calendar: the chip marks; the day total counts the diner hold (5) with the listed rows.
  await calendarDay(todayHK)
  const listed = Number(sql(`select sum(party_size) from booking_requests where restaurant_id='${RID}' and booking_date='${todayHK}' and (status in ('pending','confirmed') or (status='awaiting_deposit' and source='staff'))`))
  const cell = await text(`[data-testid=bookings-calendar-day-${todayHK}]`)
  const panelHead = (await text('[data-testid=bookings-day-panel]')).split('\n').slice(0, 3).join(' ')
  const want = String(listed + 5)
  check('calendar: day total = listed guests (no-shows left out, BOOK-007) + diner hold (5), in the day panel' + (phone ? '' : ' and the month cell'), panelHead.includes(want) && (phone || cell.includes(want)), `listed ${listed} + hold 5; panel "${panelHead}"; cell "${cell.replace(/\s+/g, ' ')}"`)
  check('calendar: chip deposit mark on the staff hold', await exists(`[data-testid=booking-chip-${ids['Wong Awaiting']}-deposit]`) || phone, phone ? 'phone grid shows dots, not chips' : '')
  await shot('03-calendar-day', 'Calendar with the day panel; totals include held seats')

  // 4. Decline a paid pending booking -> Refunded.
  const s0 = stripeLines()
  await click(rowIn(ids['Lee Paid'], 'booking-row-<id>-decline'))
  await waitFor(rowIn(ids['Lee Paid'], 'booking-row-<id>-decline-reason'))
  await click(rowIn(ids['Lee Paid'], 'booking-row-<id>-decline-send'))
  await waitUntil(`!!document.querySelector('[data-testid=booking-deposit-badge-${ids['Lee Paid']}][data-state=refunded]')`, 15000)
  check('decline paid: declined + refunded (declined), one provider refund', sql(`select status from booking_requests where id='${ids['Lee Paid']}'`) === 'declined' && depOf('Lee Paid') === 'refunded|declined|1' && stripeLines() - s0 === 1, `${depOf('Lee Paid')} stripe+${stripeLines() - s0}`)
  await sleep(1500)
  const kapso = fs.existsSync(path.join(OUT, 'kapso-fake.jsonl')) ? fs.readFileSync(path.join(OUT, 'kapso-fake.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((s) => /\/messages$/.test(s.path)) : []
  const declineText = JSON.stringify(kapso.at(-1)?.body ?? null)
  check('decline paid: the decline message (free text, open window, the diner\'s language: zh_hk by default, no member) says the deposit HK$400 will be refunded', declineText.includes('你的訂金 HK$400 將會退回'), declineText.slice(0, 300))
  await shot('04-decline-refunded', 'Declined paid booking: Refunded')

  // 5. Decline with the provider refusing -> Refund failed + Retry; Retry -> Refunded.
  fs.writeFileSync(FAIL_FLAG, '1')
  await click(rowIn(ids['Ho Paid'], 'booking-row-<id>-decline'))
  await click(rowIn(ids['Ho Paid'], 'booking-row-<id>-decline-send'))
  await waitUntil(`!!document.querySelector('[data-testid=booking-deposit-badge-${ids['Ho Paid']}][data-state=refund_failed]')`, 15000)
  check('decline, provider refuses: declined stands, refund_failed', sql(`select status from booking_requests where id='${ids['Ho Paid']}'`) === 'declined' && depOf('Ho Paid').startsWith('refund_failed'), depOf('Ho Paid'))
  check('decline, provider refuses: Retry shown', await exists(rowIn(ids['Ho Paid'], 'booking-row-<id>-refund-retry')))
  await shot('05-decline-refund-failed', 'Declined, the refund failed: Refund failed + Retry')
  fs.rmSync(FAIL_FLAG, { force: true })
  await click(rowIn(ids['Ho Paid'], 'booking-row-<id>-refund-retry'))
  await waitUntil(`!!document.querySelector('[data-testid=booking-deposit-badge-${ids['Ho Paid']}][data-state=refunded]')`, 15000)
  check('retry: refunded, attempt 2', depOf('Ho Paid') === 'refunded|declined|2', depOf('Ho Paid'))
  check('retry: toast refunded', (await toastKind()) === 'refunded', await toastKind())

  // 6. Cancel a confirmed paid booking: the dialog asks Refund / Keep / Decide later; Keep.
  await click(rowIn(ids['Cheung Paid'], 'booking-row-<id>-menu'))
  await click(`[data-testid=booking-row-${ids['Cheung Paid']}-cancel]`)
  await waitFor('[data-testid=booking-cancel-deposit]')
  check('cancel dialog: Refund / Keep / Decide later', (await exists('[data-testid=booking-cancel-deposit-refund]')) && (await exists('[data-testid=booking-cancel-deposit-keep]')) && (await exists('[data-testid=booking-cancel-deposit-later]')))
  await click('[data-testid=booking-cancel-deposit-keep]')
  await shot('06-cancel-dialog', 'Cancel dialog with the deposit choice (Keep picked)')
  await click('[data-testid=booking-cancel-confirm]')
  await waitUntil(`!!document.querySelector('[data-testid=booking-deposit-badge-${ids['Cheung Paid']}][data-state=kept]')`, 15000)
  check('cancel + keep: cancelled, kept by the staff user', sql(`select status from booking_requests where id='${ids['Cheung Paid']}'`) === 'cancelled' && depOf('Cheung Paid') === 'kept|-|0' && sql(`select count(*) from deposit_events e join booking_deposits d on d.id=e.deposit_id where d.booking_id='${ids['Cheung Paid']}' and e.event_type='kept' and e.actor_user_id is not null`) === '1', depOf('Cheung Paid'))
  await shot('07-cancel-kept', 'Cancelled: Kept')

  // 7. No-show on yesterday's paid booking -> Deposit held + Refund / Keep; Refund.
  await calendarDay(yesterdayHK)
  await click(rowIn(ids['Fong Past'], 'booking-row-<id>-no-show'))
  await waitUntil(`!!document.querySelector('[data-testid=booking-row-${ids['Fong Past']}-refund]')`, 15000)
  check('no-show paid: Deposit held + Refund + Keep', (await exists(rowIn(ids['Fong Past'], 'booking-row-<id>-deposit-held'))) && (await exists(rowIn(ids['Fong Past'], 'booking-row-<id>-keep'))))
  await shot('08-no-show-held', 'Marked no-show: Deposit held HK$400 with Refund / Keep')
  await click(rowIn(ids['Fong Past'], 'booking-row-<id>-refund'))
  await waitUntil(`!!document.querySelector('[data-testid=booking-deposit-badge-${ids['Fong Past']}][data-state=refunded]')`, 15000)
  check('no-show + Refund: refunded (staff), a second Refund is not offered', depOf('Fong Past') === 'refunded|staff|1' && !(await exists(rowIn(ids['Fong Past'], 'booking-row-<id>-refund'))), depOf('Fong Past'))
  const second = await evaluate(`fetch('/api/dashboard/bookings/${ids['Fong Past']}/deposit/refund', { method: 'POST' }).then((r) => r.status)`)
  const keepAfter = await evaluate(`fetch('/api/dashboard/bookings/${ids['Fong Past']}/deposit/keep', { method: 'POST' }).then((r) => r.status)`)
  check('a second Refund and Keep after Refund from the page -> 409', second === 409 && keepAfter === 409, `${second} ${keepAfter}`)

  // 8. Staff create: Require deposit with a phone, hidden without; save -> Awaiting deposit + Copy link.
  await goto('/dashboard/bookings?view=today', '[data-testid=bookings-today-list]')
  await click('[data-testid=booking-new-button]')
  await waitFor('[data-testid=booking-form-phone]')
  await type('[data-testid=booking-form-name]', 'Mak Walk-in')
  await type('[data-testid=booking-form-partySize]', '4')
  await setValue('[data-testid=booking-form-date]', todayHK)
  await waitFor('[data-testid=booking-form-slot-1930]')
  await click('[data-testid=booking-form-slot-1930]')
  check('create: no phone -> no Require deposit', !(await exists('[data-testid=booking-form-deposit]')))
  await shot('09-create-no-phone', 'New booking without a phone: no deposit option')
  await type('[data-testid=booking-form-phone]', '9876 5432')
  await waitFor('[data-testid=booking-form-deposit]', 10000)
  const dep = await evaluate(`(() => { const e = ${q('[data-testid=booking-form-deposit]')}; return { checked: e.checked, label: e.closest('label')?.innerText.replace(/\\s+/g, ' ') ?? '' } })()`)
  check('create: phone -> "Require deposit HK$400", on', dep.checked && dep.label.includes('HK$400'), JSON.stringify(dep))
  await focusShot('10-create-require-deposit', '[data-testid=booking-form-deposit]', 'Require deposit HK$400, on by default')
  await type('[data-testid=booking-form-phone]', '')
  await sleep(500)
  check('create: clearing the phone hides it again', !(await exists('[data-testid=booking-form-deposit]')))
  await type('[data-testid=booking-form-phone]', '9876 5432')
  const s1 = stripeLines()
  await click('[data-testid=booking-form-save]')
  await waitFor('[data-testid=booking-toast]', 20000)
  const made = idOf('Mak Walk-in')
  check('create: awaiting_deposit, staff, created_by, 24 h hold, one checkout session', sql(`select b.status||'|'||b.source||'|'||(b.created_by is not null)||'|'||d.status||'|'||round(extract(epoch from d.hold_expires_at - b.created_at)/3600) from booking_requests b join booking_deposits d on d.booking_id=b.id where b.id='${made}'`) === 'awaiting_deposit|staff|true|awaiting|24' && stripeLines() - s1 === 1, sql(`select b.status||'|'||d.status from booking_requests b join booking_deposits d on d.booking_id=b.id where b.id='${made}'`))
  check('create: toast "Link not sent, share it yourself" + Copy link (no approved template, window closed)', (await toastKind()) === 'deposit_not_sent' && (await exists('[data-testid=booking-deposit-copy-link]')), await toastKind())
  await shot('11-create-awaiting-toast', 'Saved: Awaiting deposit, toast with Copy link')
  await click('[data-testid=booking-deposit-copy-link]')
  await sleep(600)
  const clip = await evaluate('window.__copied.at(-1) ?? ""')
  check('copy link: the /p link is on the clipboard', /^http:\/\/localhost:3110\/p\/[A-Za-z0-9_-]{20,}$/.test(clip) && (await toastKind()) === 'link_copied', `${clip.slice(0, 40)}… ${await toastKind()}`)
  check('create: the row shows Awaiting deposit + Copy link', (await badge(made)) === 'awaiting' && (await exists(`[data-testid=booking-row-${made}-deposit-copy-link]`)), await badge(made))
  // Dismiss the toast first: at some widths it sits over the row's Copy link (the toast's own Copy link got the click once).
  if (await exists('[data-testid=booking-toast] button:last-of-type')) await click('[data-testid=booking-toast] button:last-of-type')
  await evaluate('window.__copied.length = 0')
  await click(`[data-testid=booking-row-${made}-deposit-copy-link]`)
  await waitUntil('window.__copied.length > 0', 30000)
  const clip2 = await evaluate('window.__copied.at(-1) ?? ""')
  check('row Copy link: the hosted checkout URL', clip2.startsWith('https://checkout.stripe.com/c/pay/cs_test_walkfake_'), clip2.slice(0, 60))
  await shot('12-today-awaiting-row', 'Today after save: the new row Awaiting deposit with Copy link')
} catch (err) {
  check('walk ran to the end', false, String(err?.stack ?? err).slice(0, 400))
  await shot('99-error', 'where it stopped').catch(() => {})
} finally {
  const probes = consoleErrors.filter((e) => /status of 409 .*\/deposit\/(refund|keep)$/.test(e))
  const real = consoleErrors.filter((e) => !probes.includes(e))
  check('0 console errors (the 2 deliberate 409 probes excluded)', real.length === 0 && probes.length <= 2, JSON.stringify({ real: real.slice(0, 5), probes: probes.length }))
  fs.writeFileSync(path.join(OUT, `walk-steps-${tag}.json`), JSON.stringify({ tag, today: todayHK, steps, consoleErrors }, null, 2))
  fs.rmSync(FAIL_FLAG, { force: true })
  ws.close(); chrome.kill()
}
