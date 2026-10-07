import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Deterministic UUIDs for idempotency
const RESTAURANT_ID = '00000000-0000-4000-a000-000000000001'

function memberId(index: number): string {
  return `00000000-0000-4000-b000-${String(index).padStart(12, '0')}`
}

function receiptId(index: number): string {
  return `00000000-0000-4000-c000-${String(index).padStart(12, '0')}`
}

function couponId(index: number): string {
  return `00000000-0000-4000-d000-${String(index).padStart(12, '0')}`
}

function campaignId(index: number): string {
  return `00000000-0000-4000-e000-${String(index).padStart(12, '0')}`
}

function eventId(index: number): string {
  return `00000000-0000-4000-f000-${String(index).padStart(12, '0')}`
}

function daysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

const FIRST_NAMES = [
  'Alice', 'Bob', 'Charlie', 'Diana', 'Edward',
  'Fiona', 'George', 'Hannah', 'Ivan', 'Julia',
  'Kevin', 'Laura', 'Michael', 'Nancy', 'Oliver',
  'Patricia', 'Quincy', 'Rachel', 'Samuel', 'Teresa',
  'Uma', 'Victor', 'Wendy', 'Xavier', 'Yolanda',
  'Zachary', 'Amber', 'Brandon', 'Cathy', 'Derek',
  'Elena', 'Frank', 'Grace', 'Henry', 'Irene',
  'James', 'Karen', 'Leo', 'Maria', 'Nathan',
  'Olivia', 'Peter', 'Quinn', 'Rosa', 'Steven',
  'Tracy', 'Ulrich', 'Vera', 'Wilson', 'Zara',
]

const LAST_NAMES = [
  'Chan', 'Wong', 'Lee', 'Cheung', 'Lam',
  'Ho', 'Ng', 'Tang', 'Kwok', 'Chow',
  'Liu', 'Chen', 'Yip', 'Fung', 'Leung',
  'Tam', 'Lai', 'Mak', 'Tsang', 'Hui',
  'Yeung', 'Cheng', 'Au', 'Siu', 'Lo',
]

function memberName(index: number): string {
  const first = FIRST_NAMES[index % FIRST_NAMES.length]
  const last = LAST_NAMES[index % LAST_NAMES.length]
  return `${first} ${last}`
}

function memberPhone(index: number): string {
  const num = 90000000 + index * 137
  return `+852${num}`
}

function couponCode(index: number): string {
  return `WELC${String(index).padStart(2, '0')}`
}

async function seedRestaurant() {
  console.log('Seeding restaurant...')
  const { error } = await supabase
    .from('restaurants')
    .upsert({
      id: RESTAURANT_ID,
      name: 'The Green Kitchen',
      slug: 'green-kitchen',
      whatsapp_number: '+85291234567',
      kapso_phone_number_id: '123456789',
    }, { onConflict: 'id' })

  if (error) throw new Error(`Restaurant: ${error.message}`)
  console.log('  Restaurant created: The Green Kitchen')
}

async function seedMembers() {
  console.log('Seeding 50 members...')
  const members = Array.from({ length: 50 }, (_, i) => {
    const joinDaysAgo = randomInt(1, 90)
    const hasRecentVisit = i < 30
    const visitDaysAgo = hasRecentVisit ? randomInt(0, 7) : null
    return {
      id: memberId(i),
      restaurant_id: RESTAURANT_ID,
      phone: memberPhone(i),
      name: memberName(i),
      points_balance: randomInt(0, 500),
      status: i < 45 ? 'active' : 'unsubscribed',
      joined_at: daysAgo(joinDaysAgo),
      last_visit_at: visitDaysAgo !== null
        ? daysAgo(visitDaysAgo) : null,
    }
  })

  const { error } = await supabase
    .from('members')
    .upsert(members, { onConflict: 'id' })

  if (error) throw new Error(`Members: ${error.message}`)
  console.log('  50 members created')
}

async function seedReceipts() {
  console.log('Seeding 100 receipts...')
  const receipts = Array.from({ length: 100 }, (_, i) => {
    const mIdx = i % 50
    const amount = randomInt(50, 500)
    return {
      id: receiptId(i),
      member_id: memberId(mIdx),
      restaurant_id: RESTAURANT_ID,
      image_url: `https://storage.example.com/receipts/${i}.jpg`,
      total_amount: amount,
      items_json: JSON.stringify([
        { name: 'Main Course', price: Math.floor(amount * 0.6) },
        { name: 'Drink', price: Math.floor(amount * 0.2) },
        { name: 'Dessert', price: Math.floor(amount * 0.2) },
      ]),
      points_awarded: Math.floor(amount / 10),
      confidence: 0.95,
      status: 'confirmed',
      processed_at: daysAgo(randomInt(0, 30)),
      created_at: daysAgo(randomInt(0, 30)),
    }
  })

  const { error } = await supabase
    .from('receipts')
    .upsert(receipts, { onConflict: 'id' })

  if (error) throw new Error(`Receipts: ${error.message}`)
  console.log('  100 receipts created')
}

async function seedCoupons() {
  console.log('Seeding 10 coupons...')
  const coupons = Array.from({ length: 10 }, (_, i) => ({
    id: couponId(i),
    restaurant_id: RESTAURANT_ID,
    type: 'welcome',
    code: couponCode(i),
    status: 'redeemed',
    member_id: memberId(i),
    redeemed_at: daysAgo(randomInt(0, 30)),
    created_at: daysAgo(randomInt(30, 60)),
  }))

  const { error } = await supabase
    .from('coupons')
    .upsert(coupons, { onConflict: 'id' })

  if (error) throw new Error(`Coupons: ${error.message}`)
  console.log('  10 coupons created')
}

async function seedCampaigns() {
  console.log('Seeding 3 campaigns...')
  const campaigns = [
    {
      id: campaignId(0),
      restaurant_id: RESTAURANT_ID,
      type: 'welcome',
      template: 'Welcome to The Green Kitchen! Enjoy 10% off.',
      schedule: JSON.stringify({ trigger: 'on_join' }),
      status: 'active',
      sent_count: 45,
      redeemed_count: 10,
    },
    {
      id: campaignId(1),
      restaurant_id: RESTAURANT_ID,
      type: 'winback',
      template: 'We miss you! Come back for a free dessert.',
      schedule: JSON.stringify({ days_inactive: 30 }),
      status: 'active',
      sent_count: 12,
      redeemed_count: 3,
    },
    {
      id: campaignId(2),
      restaurant_id: RESTAURANT_ID,
      type: 'promo',
      template: 'Summer special: 20% off all salads!',
      schedule: JSON.stringify({ send_at: '2026-04-01T10:00:00Z' }),
      status: 'draft',
      sent_count: 0,
      redeemed_count: 0,
    },
  ]

  const { error } = await supabase
    .from('campaigns')
    .upsert(campaigns, { onConflict: 'id' })

  if (error) throw new Error(`Campaigns: ${error.message}`)
  console.log('  3 campaigns created')
}

async function seedEvents() {
  console.log('Seeding 200 events...')
  const types = ['join', 'receipt', 'redeem', 'points'] as const
  const events = Array.from({ length: 200 }, (_, i) => {
    const type = types[i % types.length]
    const eventDaysAgo = i < 20 ? 0 : randomInt(0, 30)
    const mIdx = i % 50
    return {
      id: eventId(i),
      restaurant_id: RESTAURANT_ID,
      member_id: memberId(mIdx),
      type,
      data_json: JSON.stringify(buildEventData(type, mIdx)),
      created_at: daysAgo(eventDaysAgo),
    }
  })

  const { error } = await supabase
    .from('events')
    .upsert(events, { onConflict: 'id' })

  if (error) throw new Error(`Events: ${error.message}`)
  console.log('  200 events created')
}

function buildEventData(
  type: string,
  memberIndex: number,
): Record<string, unknown> {
  switch (type) {
    case 'join':
      return { source: 'whatsapp' }
    case 'receipt':
      return { receipt_id: receiptId(memberIndex) }
    case 'redeem':
      return { coupon_code: couponCode(memberIndex % 10) }
    case 'points':
      return { amount: randomInt(5, 50), reason: 'receipt' }
    default:
      return {}
  }
}

async function main() {
  console.log('Starting demo data seed...\n')

  await seedRestaurant()
  await seedMembers()
  await seedReceipts()
  await seedCoupons()
  await seedCampaigns()
  await seedEvents()

  console.log('\nSeed complete!')
  console.log(`Restaurant ID: ${RESTAURANT_ID}`)
  console.log('Set DEMO_RESTAURANT_ID in your .env file.')
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
