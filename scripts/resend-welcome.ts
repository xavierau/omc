import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

// Load .env.local
const envPath = resolve(process.cwd(), '.env.local')
try {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx)
    const val = trimmed.slice(eqIdx + 1)
    if (!process.env[key]) process.env[key] = val
  }
} catch { /* .env.local is optional */ }
import { WhatsAppClient } from '@kapso/whatsapp-cloud-api'
import QRCode from 'qrcode'

const RESTAURANT_ID = '00000000-0000-4000-a000-000000000001'
const QR_BUCKET = 'coupon-qr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

interface MemberRow {
  id: string
  phone: string
  name: string | null
  joined_at: string
}

interface CouponRow {
  code: string
  status: string
}

async function fetchRealMembers(): Promise<MemberRow[]> {
  const { data, error } = await supabase
    .from('members')
    .select('id, phone, name, joined_at')
    .eq('restaurant_id', RESTAURANT_ID)
    .order('joined_at', { ascending: false })

  if (error) throw new Error(`Fetch members: ${error.message}`)
  const targetPhones = ['+85291234567', '+85299999999']
  return ((data ?? []) as MemberRow[]).filter(
    (m) => targetPhones.includes(m.phone)
  )
}

async function fetchWelcomeCoupon(memberId: string): Promise<CouponRow | null> {
  const { data } = await supabase
    .from('coupons')
    .select('code, status')
    .eq('member_id', memberId)
    .eq('type', 'welcome')
    .single()

  return data as CouponRow | null
}

async function fetchPhoneNumberId(): Promise<string> {
  const { data, error } = await supabase
    .from('restaurants')
    .select('kapso_phone_number_id')
    .eq('id', RESTAURANT_ID)
    .single()

  if (error || !data) throw new Error(`Restaurant: ${error?.message}`)
  return (data as Record<string, string>).kapso_phone_number_id
}

async function uploadQrAndGetUrl(couponCode: string): Promise<string> {
  const buffer = await QRCode.toBuffer(`REDEEM ${couponCode}`, {
    width: 300,
    margin: 2,
    color: { dark: '#1a1a2e', light: '#ffffff' },
    errorCorrectionLevel: 'H',
  })

  const filePath = `${couponCode}.png`
  const { error } = await supabase.storage
    .from(QR_BUCKET)
    .upload(filePath, buffer, { contentType: 'image/png', upsert: true })

  if (error) throw new Error(`QR upload: ${error.message}`)

  const { data } = supabase.storage.from(QR_BUCKET).getPublicUrl(filePath)
  return data.publicUrl
}

function buildWelcomeText(name: string | null, couponCode: string): string {
  const greeting = name ? `, ${name}` : ''
  return [
    `Welcome to our loyalty program${greeting}!`,
    '',
    `You've received a welcome gift!`,
    `Use code: ${couponCode}`,
    '',
    `Reply POINTS to check balance, or send a receipt photo to earn points.`,
  ].join('\n')
}

async function sendWelcomeMessages(
  client: WhatsAppClient,
  phoneNumberId: string,
  member: MemberRow,
  couponCode: string
) {
  await client.messages.sendText({
    phoneNumberId,
    to: member.phone,
    body: buildWelcomeText(member.name, couponCode),
  })

  const qrUrl = await uploadQrAndGetUrl(couponCode)
  const caption = `Your Welcome Coupon: ${couponCode}\n\nShow this QR code to our staff to redeem.`
  await client.messages.sendImage({
    phoneNumberId,
    to: member.phone,
    image: { link: qrUrl, caption },
  })
}

async function main() {
  const isSend = process.argv.includes('--send')
  const mode = isSend ? 'SEND' : 'DRY-RUN'
  console.log(`\nMode: ${mode}\n`)

  console.log('Fetching real members (excluding seeded data)...')
  const members = await fetchRealMembers()

  if (members.length === 0) {
    console.log('No real members found. Nothing to do.')
    return
  }

  console.log(`Found ${members.length} real member(s):\n`)

  type MemberWithCoupon = { member: MemberRow; coupon: CouponRow | null }
  const memberCoupons: MemberWithCoupon[] = []

  for (const member of members) {
    const coupon = await fetchWelcomeCoupon(member.id)
    memberCoupons.push({ member, coupon })
    const couponInfo = coupon
      ? `code=${coupon.code} (${coupon.status})`
      : 'NO COUPON'
    console.log(
      `  ${member.name ?? '(no name)'} | ${member.phone} | joined ${member.joined_at} | ${couponInfo}`
    )
  }

  if (!isSend) {
    console.log('\nDry run complete. Pass --send to actually send messages.')
    return
  }

  const kapsoApiKey = process.env.KAPSO_API_KEY
  if (!kapsoApiKey) {
    console.error('Missing KAPSO_API_KEY')
    process.exit(1)
  }

  console.log('\nSending welcome messages...\n')
  const phoneNumberId = await fetchPhoneNumberId()
  const client = new WhatsAppClient({
    kapsoApiKey,
    baseUrl: 'https://api.kapso.ai/meta/whatsapp',
  })

  for (const { member, coupon } of memberCoupons) {
    if (!coupon) {
      console.log(`  SKIP ${member.phone} — no welcome coupon found`)
      continue
    }

    try {
      await sendWelcomeMessages(client, phoneNumberId, member, coupon.code)
      console.log(`  SENT ${member.phone} (${member.name ?? 'unnamed'}) — code ${coupon.code}`)
    } catch (err) {
      console.error(`  FAIL ${member.phone}: ${(err as Error).message}`)
    }
  }

  console.log('\nDone!')
}

main().catch((err) => {
  console.error('Script failed:', err)
  process.exit(1)
})
