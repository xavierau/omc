import { vi } from 'vitest'

export function mockCouponRepository() {
  return {
    findCouponByCode: vi.fn().mockResolvedValue(null),
    redeemCoupon: vi.fn().mockResolvedValue(undefined),
    incrementCouponUses: vi.fn().mockResolvedValue(undefined),
    decrementCouponUses: vi.fn().mockResolvedValue(undefined),
    createCoupon: vi.fn().mockResolvedValue(null),
    createWelcomeCoupon: vi.fn().mockResolvedValue(null),
  }
}

export function mockCouponRedemptionRepository() {
  return {
    createRedemption: vi.fn().mockResolvedValue(undefined),
    hasRedeemed: vi.fn().mockResolvedValue(false),
  }
}

export function mockEventRepository() {
  return {
    createEvent: vi.fn().mockResolvedValue(undefined),
  }
}

export function mockCampaignRepository() {
  return {
    getCampaignById: vi.fn().mockResolvedValue(null),
    incrementCampaignRedeemed: vi.fn().mockResolvedValue(undefined),
    incrementCampaignSent: vi.fn().mockResolvedValue(undefined),
    transitionCampaignStatus: vi.fn().mockResolvedValue(true),
    updateCampaign: vi.fn().mockResolvedValue(undefined),
    setCampaignMembers: vi.fn().mockResolvedValue(undefined),
    getCampaignMemberIds: vi.fn().mockResolvedValue([]),
  }
}

export function mockRestaurantRepository() {
  return {
    getRestaurantPhoneNumberId: vi.fn().mockResolvedValue('phone-id'),
    getRestaurantName: vi.fn().mockResolvedValue('Test Restaurant'),
    findBySlug: vi.fn().mockResolvedValue(null),
  }
}

export function mockKapsoClient() {
  return {
    sendTextMessage: vi.fn().mockResolvedValue(undefined),
    sendImageMessage: vi.fn().mockResolvedValue(undefined),
    sendInteractiveButtons: vi.fn().mockResolvedValue(undefined),
  }
}

export function mockRewardRepository() {
  return {
    getRewardById: vi.fn().mockResolvedValue(null),
    listActiveRewards: vi.fn().mockResolvedValue([]),
  }
}

export function mockMemberRepository() {
  return {
    deductMemberPoints: vi.fn().mockResolvedValue(0),
    getMemberById: vi.fn().mockResolvedValue(null),
  }
}

export function mockReceiptRepository() {
  return {
    updateReceipt: vi.fn().mockResolvedValue(undefined),
    createReceipt: vi.fn().mockResolvedValue('receipt-1'),
  }
}

export function mockSupabaseStorage() {
  return {
    uploadCouponQr: vi.fn().mockResolvedValue('https://example.com/qr.png'),
  }
}

export function mockWhatsAppTemplateRepository() {
  return {
    findTemplateById: vi.fn().mockResolvedValue(null),
  }
}
