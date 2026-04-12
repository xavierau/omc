import type { Coupon } from '@/domain/entities/coupon'
import type { Campaign, CouponConfig } from '@/domain/entities/campaign'
import type { Member } from '@/domain/entities/member'
import type { Restaurant } from '@/domain/entities/restaurant'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import type { ParsedReceipt } from '@/domain/interfaces/parsed-receipt'

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
    trialExpiresAt: null,
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
