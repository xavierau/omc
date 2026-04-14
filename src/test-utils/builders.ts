import type { Coupon } from '@/domain/entities/coupon'
import type { Campaign, CouponConfig } from '@/domain/entities/campaign'
import type { Member } from '@/domain/entities/member'
import type { PosIntegration } from '@/domain/entities/pos-integration'
import type { PosTransaction } from '@/domain/entities/pos-transaction'
import type { Restaurant } from '@/domain/entities/restaurant'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import type { ParsedReceipt } from '@/domain/interfaces/parsed-receipt'
import type { PosFieldMapping } from '@/domain/value-objects/pos-field-mapping'

export function buildCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'coupon-1',
    restaurantId: 'restaurant-1',
    type: 'promo',
    code: 'TEST123',
    status: 'active',
    memberId: 'member-1',
    expiresAt: null,
    redeemedAt: null,
    discountType: 'percentage',
    discountValue: 10,
    maxUses: 1,
    currentUses: 0,
    isActive: true,
    title: 'Test Coupon',
    description: null,
    campaignId: null,
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

export function buildCampaign(
  overrides: Partial<Campaign> = {}
): Campaign {
  return {
    id: 'campaign-1',
    restaurantId: 'restaurant-1',
    name: 'Test Campaign',
    type: 'promo',
    template: 'Hi {{name}}, use code {{code}}!',
    couponConfig: null,
    schedule: null,
    scheduledAt: null,
    status: 'active',
    sentCount: 0,
    redeemedCount: 0,
    whatsappTemplateId: null,
    targetAudience: 'all',
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

export function buildCouponConfig(
  overrides: Partial<CouponConfig> = {}
): CouponConfig {
  return {
    discountType: 'percentage',
    discountValue: 10,
    expiresInDays: 30,
    ...overrides,
  }
}

export function buildMember(
  overrides: Partial<Member> = {}
): Member {
  return {
    id: 'member-1',
    restaurantId: 'restaurant-1',
    phone: '85291234567',
    name: 'Test User',
    pointsBalance: 100,
    status: 'active',
    joinedAt: '2025-01-01T00:00:00Z',
    lastVisitAt: null,
    ...overrides,
  }
}

export function buildRestaurant(
  overrides: Partial<Restaurant> = {}
): Restaurant {
  return {
    id: 'restaurant-1',
    name: 'Test Restaurant',
    slug: 'test-restaurant',
    whatsappNumber: '85290000000',
    kapsoPhoneNumberId: 'phone-number-id-1',
    metaBusinessAccountId: null,
    status: 'active',
    plan: 'starter',
    trialExpiresAt: null,
    referrerId: null,
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

export function buildWhatsAppTemplate(
  overrides: Partial<WhatsAppTemplate> = {}
): WhatsAppTemplate {
  return {
    id: 'template-1',
    restaurantId: 'restaurant-1',
    metaTemplateId: null,
    name: 'test_template',
    language: 'en',
    category: 'MARKETING',
    status: 'approved',
    components: [
      { type: 'BODY', text: 'Hello {{customer_name}}!' },
    ],
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

export function buildParsedReceipt(
  overrides: Partial<ParsedReceipt> = {}
): ParsedReceipt {
  return {
    total: 150,
    items: [{ name: 'Lunch Set', price: 150 }],
    confidence: 0.95,
    currency: 'HKD',
    receiptNumber: 'REC-001',
    merchantName: 'Test Restaurant',
    tamperAssessment: null,
    ...overrides,
  }
}

export function buildPosFieldMapping(
  overrides: Partial<PosFieldMapping> = {}
): PosFieldMapping {
  return {
    transactionId: '$.transaction.id',
    amount: '$.transaction.total',
    currency: 'HKD',
    eventType: '$.event_type',
    eventTypeMapping: { payment_completed: 'sale', refund_completed: 'refund' },
    customerPhone: '$.customer.phone',
    timestamp: '$.created_at',
    ...overrides,
  }
}

export function buildPosIntegration(
  overrides: Partial<PosIntegration> = {}
): PosIntegration {
  return {
    id: 'pos-integration-1',
    restaurantId: 'restaurant-1',
    provider: 'generic',
    name: 'Main POS',
    status: 'active',
    webhookSecret: 'test-webhook-secret',
    fieldMapping: buildPosFieldMapping(),
    credentials: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

export function buildPosTransaction(
  overrides: Partial<PosTransaction> = {}
): PosTransaction {
  return {
    id: 'pos-tx-1',
    posIntegrationId: 'pos-integration-1',
    restaurantId: 'restaurant-1',
    memberId: 'member-1',
    externalTransactionId: 'ext-tx-001',
    type: 'sale',
    amount: 150,
    currency: 'HKD',
    customerPhone: '+85291234567',
    pointsAwarded: 15,
    rawPayload: { transaction: { id: 'ext-tx-001', total: 150 } },
    processedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}
